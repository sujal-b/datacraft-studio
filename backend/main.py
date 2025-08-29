from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel
import shutil
import os
import glob
import json
from typing import Optional, Dict, Any
from fastapi.staticfiles import StaticFiles
from celery_worker import celery_app as worker, generate_comprehensive_stats
from celery.result import AsyncResult
from fastapi.middleware.cors import CORSMiddleware
from redis import Redis
from dotenv import load_dotenv

load_dotenv()
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
REDIS_DB_CACHE = int(os.getenv("REDIS_DB_CACHE", 1))
redis_cache: Redis = Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB_CACHE, decode_responses=True)

app = FastAPI()

origins = ["http://localhost:5173"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CleanRequest(BaseModel):
    dataset_name: str
    action_type: str

public_dir = os.path.join(os.path.dirname(__file__), '..', 'public')
class TaskRequest(BaseModel):
    dataset_name: str
    column_name: str
    task_type: str
    task_params: Optional[Dict[str, Any]] = None

def get_next_version_path(file_path: str) -> str:
    if not os.path.exists(file_path):
        return file_path
    base, ext = os.path.splitext(file_path)
    version = 1
    while True:
        new_path = f"{base} ({version}){ext}"
        if not os.path.exists(new_path):
            return new_path
        version += 1

@app.post("/api/upload")
async def upload_dataset(file: UploadFile = File(...)):
    try:
        original_path = os.path.join(public_dir, file.filename)
        versioned_path = get_next_version_path(original_path)
        with open(versioned_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        generate_comprehensive_stats.delay(versioned_path)
        return {"status": "SUCCESS", "message": "File uploaded", "path": f"/{os.path.basename(versioned_path)}", "name": os.path.basename(versioned_path)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save file: {e}")

@app.get("/api/datasets")
async def get_available_datasets():
    try:
        csv_files = glob.glob(os.path.join(public_dir, "*.csv"))
        datasets = []
        for file_path in csv_files:
            file_name = os.path.basename(file_path)
            datasets.append({"name": file_name, "path": f"/{file_name}", "source": "server"})
        return datasets
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list datasets: {str(e)}")

@app.get("/api/datasets/dashboard-summary")
async def get_dashboard_summary():
    try:
        disk_files = {os.path.basename(p) for p in glob.glob(os.path.join(public_dir, "*.csv"))}
        cached_files = {k.split(':')[1] for k in redis_cache.keys("statistics:*")}
        files_to_process = disk_files - cached_files
        for filename in files_to_process:
            generate_comprehensive_stats.delay(os.path.join(public_dir, filename))
        
        stat_keys = redis_cache.keys("statistics:*")
        if not stat_keys: return []
        
        all_stats = [json.loads(s) for s in redis_cache.mget(stat_keys) if s]
        
        summaries = [{
            "id": stats["filename"], "filename": stats["filename"], "size": stats["size"],
            "rows": stats["rows"], "columns": stats["columns"], "status": stats["status"],
            "qualityScore": stats["qualityScore"], "missing": stats["missing_pct"],
            "duplicates": stats["duplicates_pct"], "inconsistencies": 0,
            "lastModified": stats["lastModified"]
        } for stats in all_stats]
        return summaries
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve summaries: {str(e)}")
    
@app.get("/api/dataset/{dataset_name}/statistics")
async def get_dataset_statistics(dataset_name: str):
    cache_key = f"statistics:{dataset_name}"
    cached_result = redis_cache.get(cache_key)
    if cached_result:
        return json.loads(cached_result)
    else:
        file_path = os.path.join(public_dir, dataset_name)
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="Dataset not found.")
        generate_comprehensive_stats.delay(file_path)
        raise HTTPException(status_code=202, detail="Statistics generation is in progress.")
    
@app.post("/api/dataset/{dataset_name}/refresh-statistics")
async def refresh_dataset_statistics(dataset_name: str):
    file_path = os.path.join(public_dir, dataset_name)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Dataset not found.")
    
    cache_key = f"statistics:{dataset_name}"
    redis_cache.delete(cache_key)
    generate_comprehensive_stats.delay(file_path)
    return {"message": "Statistics refresh initiated."}



@app.post("/api/submit_task")
async def submit_task(request: TaskRequest):
    task = worker.send_task(
        'celery_worker.route_task',
        args=[request.dataset_name, request.column_name, request.task_type, request.task_params]
    )
    return {"job_id": task.id, "status": "Job accepted."}

@app.get("/api/analyze/status/{job_id}")
async def get_analysis_status(job_id: str):
    task_result = AsyncResult(job_id, app=worker)
    if task_result.ready():
        if task_result.successful():
            return task_result.get()
        else:
            return {"status": "FAILURE", "error": str(task_result.info)}
    else:
        return {"status": "PENDING"}

@app.post("/api/statistics/{dataset_name}")
async def start_statistics_generation(dataset_name: str):
    try:
        file_path = os.path.join(public_dir, dataset_name)
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="Dataset not found.")
        task = generate_comprehensive_stats.delay(file_path)
        return {"job_id": task.id, "status": "Statistics generation job started."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/statistics/status/{job_id}")
async def get_statistics_status(job_id: str):
    task_result = AsyncResult(job_id, app=worker)
    if task_result.ready():
        if task_result.successful():
            return task_result.get()
        else:
            return {"status": "FAILURE", "error": str(task_result.info)}
    else:
        return {"status": "PENDING"}
    
@app.post("/api/dataset/clean")
async def clean_dataset(request: CleanRequest):
    try:
        file_path = os.path.join(public_dir, request.dataset_name)
        if not os.path.exists(file_path):
            raise HTTPException(status_code=404, detail="Dataset not found.")

        task = worker.send_task(
            'celery_worker.perform_dataset_cleaning_task',
            args=[file_path, request.action_type]
        )
        
        return {"job_id": task.id, "message": f"Dataset cleaning job '{request.action_type}' started."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

app.mount("/", StaticFiles(directory=public_dir, html=True), name="public")