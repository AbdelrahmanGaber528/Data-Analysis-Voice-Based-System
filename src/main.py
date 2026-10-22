from fastapi import FastAPI
from api import base_router


app = FastAPI(title="DA Voice System" , description="data analysis platform to upload your data , and ask questions , apply queries , make descisions about it in same place ")


app.include_router(base_router)