from datetime import date
from uuid import UUID
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from model import predict, MODEL_VERSION, InsufficientHistory
from selection import PIPELINE_VERSION

app = FastAPI(title="Coffee forecast adapter", version="0.1.0")

class Sale(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: date
    product_id: UUID
    qty: float = Field(ge=0, le=1_000_000, allow_inf_nan=False)
    unit_price: float = Field(ge=0, le=20_000_000, allow_inf_nan=False)
    source: str = Field(pattern="^(actual|demo)$")

class ForecastRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date_from: date
    date_to: date
    product_id: UUID | None = None
    product_ids: list[UUID] = Field(min_length=1, max_length=1000)
    history: list[Sale] = Field(default_factory=list, max_length=200000)

@app.get("/health")
def health():
    return {"status": "ok", "model_version": PIPELINE_VERSION, "source_model_version": MODEL_VERSION,
            "mode": "adaptive", "interval_kind": "unavailable", "minimum_history_days": 28,
            "selection_minimum_days_by_horizon": {"1": 42, "7": 56, "30": 88}}

@app.post("/forecast")
def forecast(request: ForecastRequest):
    ids = [str(request.product_id)] if request.product_id else [str(p) for p in request.product_ids]
    try:
        return predict(str(request.date_from), str(request.date_to), ids,
                       [dict(date=str(s.date), product_id=str(s.product_id), qty=s.qty, unit_price=s.unit_price, source=s.source) for s in request.history])
    except InsufficientHistory as error:
        raise HTTPException(status_code=422, detail={"code": "FORECAST_INSUFFICIENT_HISTORY"}) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
