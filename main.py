from fastapi import FastAPI
from dotenv import load_dotenv
from api import base_router

load_dotenv()


app = FastAPI(title="DA Voice System" , description="data analysis platform to upload your data , and ask questions , apply queries , make descisions about it in same place ")


app.include_router(base_router)
