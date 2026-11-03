from datetime import date
from uuid import UUID
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field, ConfigDict
from forecast_errors import InsufficientHistory
from engine import predict, PIPELINE_VERSION as CURRENT_PIPELINE

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
    pipeline: str = Field(default="v5", pattern="^v5$")
    cohort: str = Field(default="genuine", pattern="^(genuine|simulation|demo)$")
    method_policy: str = Field(default='auto',pattern='^(auto|mean28|weekly)$')

@app.get("/health")
def health():
    return {"status": "ok", "model_version": CURRENT_PIPELINE,
            "mode": "adaptive", "interval_kind": "empirical_absolute_80_when_calibrated", "minimum_history_days": 1,"model_selection_minimum_days":28,
            "history_window_days":180,"minimum_observation_window_days":56,"maximum_unobserved_gap_days":6,
            "minimum_calibration_samples":20,"selection_policy":"available prior-only folds after reserving calibration"}

@app.post("/forecast")
def forecast(request: ForecastRequest):
    ids = [str(request.product_id)] if request.product_id else [str(p) for p in request.product_ids]
    try:
        rows = [dict(date=str(s.date), product_id=str(s.product_id), qty=s.qty, unit_price=s.unit_price, source=s.source) for s in request.history]
        return predict(str(request.date_from), str(request.date_to), ids, rows, request.cohort, request.method_policy)
    except InsufficientHistory as error:
        raise HTTPException(status_code=422, detail={"code": "FORECAST_INSUFFICIENT_HISTORY"}) from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
