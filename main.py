from fastapi import FastAPI
from dotenv import load_dotenv

load_dotenv(".env")

app = FastAPI(title="DA Voice System" , description="data analysis platform to upload your data , and ask questions , apply queries , make descisions about it in same place ")


@app.get("/health")
async def health():

    return {"status":"OK , server on"}
