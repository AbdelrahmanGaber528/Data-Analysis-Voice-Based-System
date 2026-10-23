import json
import os
import re
import sqlite3

import pandas as pd
from sqlalchemy import create_engine

from helpers.prompts import load_prompt
from models import ProcessExtension
from .BaseController import BaseController


class SQLiteController(BaseController):

    TABLE_NAME = "dataset"
    DEFAULT_MAX_RESULT_ROWS = 200
    MAX_RESULT_ROWS_CAP = 200
    TABULAR_EXTENSIONS = (ProcessExtension.CSV.value, ProcessExtension.XLSX.value)

    FORBIDDEN_SQL_KEYWORDS = {
        "alter", "attach", "create", "delete", "detach", "drop", "insert",
        "pragma", "reindex", "replace", "trigger", "update", "vacuum",
    }

    def __init__(self, dataset_id: str):

        super().__init__()

        self.dataset_id = dataset_id
        self.dataset_path = os.path.join(self.file_dir, dataset_id)

        self.database_dir = os.path.join(self.base_dir, "assets/databases")
        self.database_path = os.path.join(self.database_dir, f"{dataset_id}.db")
        self.max_result_rows = self.DEFAULT_MAX_RESULT_ROWS




    def get_data_file(self):

        data_files = []

        for name in os.listdir(self.dataset_path):
            file_path = os.path.join(self.dataset_path, name)
            extension = os.path.splitext(name)[-1].lower()

            if os.path.isfile(file_path) and extension in self.TABULAR_EXTENSIONS:
                data_files.append(file_path)

        # The analysis uses the most recently uploaded tabular file.
        return max(data_files, key=os.path.getmtime)




    def prepare_database(self):

        data_file = self.get_data_file()

        if data_file is None:
            raise FileNotFoundError("No tabular data file found for this dataset.")

        if self._is_database_fresh(data_file):
            return self.database_path

        dataframe = self._read_data_file(data_file)

        if dataframe.empty:
            raise ValueError("The data file does not contain any rows.")

        self._clean_columns(dataframe)

        os.makedirs(self.database_dir, exist_ok=True)

        engine = create_engine(f"sqlite:///{self.database_path}")

        try:
            dataframe.to_sql(
                self.TABLE_NAME,
                engine,
                if_exists="replace",
                index=False,
            )
        finally:
            engine.dispose()

        return self.database_path




    def get_schema(self):

        connection = sqlite3.connect(self.database_path)

        try:
            columns = connection.execute(
                f'PRAGMA table_info("{self.TABLE_NAME}")'
            ).fetchall()

            row_count = connection.execute(
                f'SELECT COUNT(*) FROM "{self.TABLE_NAME}"'
            ).fetchone()[0]

            sample_rows = pd.read_sql_query(
                f'SELECT * FROM "{self.TABLE_NAME}" LIMIT 3',
                connection,
            )

        finally:
            connection.close()

        schema_lines = [
            f'Table "{self.TABLE_NAME}" ({row_count} rows)',
            "Columns:",
        ]

        for column in columns:
            schema_lines.append(f'- "{column[1]}" ({column[2] or "TEXT"})')

        samples = json.loads(sample_rows.to_json(orient="records", date_format="iso"))

        schema_lines.append("Sample rows:")
        schema_lines.append(json.dumps(samples, ensure_ascii=False))

        return "\n".join(schema_lines)




    def generate_sql(self, question: str, schema: str, llm):

        messages = [
            {"role": "system", "content": load_prompt("sql")},
            {
                "role": "user",
                "content": f"DATABASE SCHEMA:\n{schema}\n\nUSER QUESTION:\n{question}",
            },
        ]

        response = llm.chat(messages)

        query_plan = self._parse_query_plan(response)
        query_plan["sql"] = self._validate_query(query_plan["sql"])

        return query_plan



    def set_max_result_rows(self, limit: int):

        try:
            value = int(limit)
        except (TypeError, ValueError):
            raise ValueError("limit must be a positive integer.")

        if value < 1:
            raise ValueError("limit must be at least 1.")

        if value > self.MAX_RESULT_ROWS_CAP:
            raise ValueError(f"limit cannot exceed {self.MAX_RESULT_ROWS_CAP}.")

        self.max_result_rows = value
        return self.max_result_rows




    def _read_data_file(self, data_file: str):

        extension = os.path.splitext(data_file)[-1].lower()

        if extension == ProcessExtension.CSV.value:
            return pd.read_csv(data_file, encoding="utf-8-sig")

        if extension == ProcessExtension.XLSX.value:
            return pd.read_excel(data_file)

        raise ValueError(f"Unsupported data file type: {extension}")




    def _is_database_fresh(self, data_file: str):

        if not os.path.exists(self.database_path):
            return False

        return os.path.getmtime(self.database_path) >= os.path.getmtime(data_file)




    def _clean_columns(self, dataframe):

        seen = {}
        columns = []

        for index, column in enumerate(dataframe.columns):
            name = str(column).replace('"', "").strip() or f"column_{index}"
            count = seen.get(name, 0)

            if count:
                name = f"{name}_{count}"

            seen[name] = count + 1
            columns.append(name)

        dataframe.columns = columns



    def _parse_query_plan(self, response: str):

        text = (response or "").strip()

        if not text:
            raise ValueError("The model returned an empty response.")

        payload = self._load_json(text)

        if isinstance(payload, dict):
            sql = str(payload.get("sql", "")).strip()
            explanation = str(payload.get("explanation", "")).strip()
        else:
            sql = self._extract_sql(text)
            explanation = ""

        if not sql:
            sql = self._extract_sql(text)

        if not sql:
            raise ValueError("Could not extract a SQL query from the model response.")

        if not explanation:
            explanation = "The query below answers your question using the attached dataset."

        return {
            "sql": sql,
            "explanation": explanation,
        }



    @staticmethod
    def _load_json(text: str):

        fenced = re.search(
            r"```(?:json)?\s*(.*?)```",
            text,
            flags=re.DOTALL | re.IGNORECASE,
        )

        candidate = fenced.group(1).strip() if fenced else text

        try:
            return json.loads(candidate)

        except json.JSONDecodeError:
            pass

        # Try to find a complete JSON object (non-greedy, balanced attempt)
        start = candidate.find('{')
        if start != -1:
            depth = 0
            in_str = None
            i = start
            while i < len(candidate):
                ch = candidate[i]
                if in_str:
                    if ch == '\\':
                        i += 2
                        continue
                    if ch == in_str:
                        in_str = None
                    i += 1
                    continue
                else:
                    if ch in ('"', "'"):
                        in_str = ch
                        i += 1
                        continue
                    if ch == '{':
                        depth += 1
                    elif ch == '}':
                        depth -= 1
                        if depth == 0:
                            snippet = candidate[start:i+1]
                            try:
                                return json.loads(snippet)
                            except json.JSONDecodeError:
                                break
                    i += 1
                    continue

        return None



    @staticmethod
    def _extract_sql(text: str):

        fenced = re.search(
            r"```(?:sql)?\s*(.*?)```",
            text,
            flags=re.DOTALL | re.IGNORECASE,
        )

        candidate = fenced.group(1).strip() if fenced else text.strip()

        match = re.search(r"\b(select|with)\b.*", candidate, flags=re.DOTALL | re.IGNORECASE)

        if not match:
            return ""

        query = match.group(0).strip()

        if ";" in query:
            query = query.split(";", 1)[0].strip()

        return query

    def _validate_query(self, sql: str):

        query = (sql or "").strip().strip("`").strip().rstrip(";").strip()

        if not query:
            raise ValueError("The generated SQL query is empty.")

        if ";" in query:
            raise ValueError("Only a single SQL statement is allowed.")

        # Ignore comments, string literals and quoted identifiers while checking keywords.
        normalized = re.sub(r"--[^\n]*", " ", query)
        normalized = re.sub(r"/\*.*?\*/", " ", normalized, flags=re.DOTALL)
        normalized = re.sub(r"'(?:''|[^'])*'", "''", normalized)
        normalized = re.sub(r'"(?:""|[^"])*"', '""', normalized)

        tokens = re.findall(r"[A-Za-z_]+", normalized)

        if not tokens or tokens[0].lower() not in ("select", "with"):
            raise ValueError("Only read-only SELECT queries are allowed.")

        forbidden = {token.lower() for token in tokens} & self.FORBIDDEN_SQL_KEYWORDS

        if forbidden:
            raise ValueError("Only read-only SELECT queries are allowed.")

        return query



    def execute_query(self, sql: str, limit: int | None = None):

        query = self._validate_query(sql)

        if limit is None:
            max_rows = self.max_result_rows
        else:
            max_rows = self._coerce_limit(limit)

        connection = sqlite3.connect(self.database_path)

        try:
            connection.execute("PRAGMA query_only = ON")
            dataframe = pd.read_sql_query(query, connection)
        finally:
            connection.close()

        dataframe = dataframe.head(max_rows)

        columns = [str(column) for column in dataframe.columns]
        results = json.loads(dataframe.to_json(orient="records", date_format="iso"))

        return columns, results




    def analyze(self, question: str, llm, limit: int | None = None):

        if limit is not None:
            self.set_max_result_rows(limit)

        self.prepare_database()

        schema = self.get_schema()
        query_plan = self.generate_sql(question, schema, llm)

        columns, results = self.execute_query(query_plan["sql"], limit=limit)

        return {
            "mode": "analysis",
            "explanation": query_plan["explanation"],
            "columns": columns,
            "results": results,
            "limit": self.max_result_rows,
            "max_limit": self.MAX_RESULT_ROWS_CAP,
        }




    def _coerce_limit(self, limit: int):

        try:
            value = int(limit)
        except (TypeError, ValueError):
            raise ValueError("limit must be a positive integer.")

        if value < 1:
            raise ValueError("limit must be at least 1.")

        if value > self.MAX_RESULT_ROWS_CAP:
            raise ValueError(f"limit cannot exceed {self.MAX_RESULT_ROWS_CAP}.")

        return value
