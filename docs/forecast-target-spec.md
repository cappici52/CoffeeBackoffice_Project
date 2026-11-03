# CoffeeBackoffice Project — Forecasting System Implementation Plan

## Project
Repository: `https://github.com/cappici52/CoffeeBackoffice_Project`

This is a graduation/final-year project. The forecasting module must be designed as a real decision-support feature for the coffee shop backoffice system, not as a standalone AI demo.

The main goal is:

> Forecast menu-level demand, convert forecasts into ingredient requirements, compare requirements with current inventory, and provide preparation/stock recommendations.

---

# 1. Main Objectives

Implement and improve the forecasting system so that it can:

1. Forecast expected sales quantity for each menu item.
2. Support forecast horizons of:
   - 1 day
   - 7 days
   - 30 days
3. Compare multiple forecasting methods.
4. Automatically select the best-performing model.
5. Evaluate forecasts using historical actual sales.
6. Convert menu forecasts into required ingredient quantities.
7. Compare forecasted ingredient requirements with current stock.
8. Generate preparation and restocking recommendations.
9. Display forecasting results clearly in the Backoffice dashboard.
10. Store forecast history so previous predictions can be compared with actual results.

---

# 2. Forecast Target

The primary forecast target must be:

```text
quantity sold per menu item per business day
```

Do NOT use total revenue as the main target.

Example:

| date | product_id | product_name | actual_qty |
|---|---:|---|---:|
| 2026-11-01 | 1 | Americano | 35 |
| 2026-11-01 | 2 | Latte | 21 |
| 2026-11-01 | 3 | Cappuccino | 17 |
| 2026-11-02 | 1 | Americano | 31 |
| 2026-11-02 | 2 | Latte | 25 |

Expected forecast output:

```text
2026-11-04

Americano    32
Latte        24
Cappuccino   18
Mocha        11
```

Only completed/fulfilled orders should normally count as demand history.

Cancelled orders must not be included as fulfilled sales.

---

# 3. Forecast Horizons

The system should support three main forecast horizons.

## 1-day forecast

Purpose:

```text
What should the shop prepare for tomorrow?
```

Used for daily preparation.

## 7-day forecast

Purpose:

```text
How much stock and ingredients should be prepared for the next week?
```

This should be treated as the main operational forecast.

## 30-day forecast

Purpose:

```text
What is the expected sales trend for the next month?
```

Used mainly for management-level trend analysis.

---

# 4. Historical Dataset

Build a daily demand dataset from completed orders.

Recommended dataset structure:

```text
date
product_id
product_name
quantity
price
day_of_week
month
is_weekend
```

Additional useful columns:

```text
shop_open
stockout
promotion
holiday
special_event
```

Future optional data:

```text
temperature
rain
weather_condition
```

Weather integration is NOT required for the first stable version.

Focus on internal shop data first.

---

# 5. Feature Engineering

Create time-series features without leaking future data.

Recommended features:

```text
lag_1
lag_7
lag_14
lag_28

mean_7
mean_14
mean_28

std_7
std_28

day_of_week
day_of_month
week_of_year
month
is_weekend

latest_price
```

Optional:

```text
promotion
holiday
stockout
shop_closed
special_event
```

Example:

To predict Latte demand for today, the model may use:

```text
yesterday sales
sales 7 days ago
sales 14 days ago
sales 28 days ago

7-day rolling average
28-day rolling average

weekday
month
price
```

IMPORTANT:

Rolling statistics must only use past data.

Never calculate a feature using future actual demand.

---

# 6. Forecast Candidate Models

Do NOT force Machine Learning to always win.

The system should compare multiple candidates.

Recommended candidates:

```text
Last Value
Last Matching Weekday
7-Day Mean
28-Day Mean
Weekday Mean
Simple Exponential Smoothing
XGBoost
```

Possible architecture:

```text
Historical Sales
       |
       v
Feature Engineering
       |
       +----------------------+
       |          |           |
       v          v           v
   Baseline      SES       XGBoost
       |          |           |
       +----------+-----------+
                  |
                  v
           Model Evaluation
                  |
                  v
            Best Model
                  |
                  v
              Forecast
```

If a simple baseline is more accurate than XGBoost, the baseline must be selected.

Do not choose XGBoost only because it is an ML model.

---

# 7. Model Validation

Do NOT use random train/test split for time-series forecasting.

Incorrect:

```text
random 80/20 split
```

Correct:

Use chronological or rolling validation.

Example:

```text
Day 1 -------------------------------- Day 180

|------------ TRAIN ------------|
                         | VALID |

|---------------- TRAIN ----------------|
                                  | VALID |
```

Recommended approach:

```text
rolling-origin validation
```

Each validation fold must simulate a real forecast:

```text
train on past data
predict future period
compare with actual future values
```

No future information may be available during training.

---

# 8. Evaluation Metrics

Calculate at least:

## MAE

Primary metric.

Example:

```text
MAE = 3
```

Meaning:

```text
The forecast is wrong by about 3 cups per menu item per day on average.
```

## RMSE

Useful for detecting large errors.

## WAPE

Useful for reporting overall percentage error.

## Bias

Used to determine whether forecasts systematically overpredict or underpredict.

Example:

```text
Bias > 0
```

Usually overforecasting.

```text
Bias < 0
```

Usually underforecasting.

Optional:

```text
MAPE
sMAPE
```

Be careful with percentage metrics when actual demand is zero.

---

# 9. Automatic Model Selection

Implement model selection using validation results.

Example:

```text
Weekly Naive MAE = 3.2
Mean 7 MAE      = 2.9
SES MAE         = 3.0
XGBoost MAE     = 2.4
```

Selected model:

```text
XGBoost
```

But:

```text
Weekly Naive MAE = 2.5
XGBoost MAE      = 2.8
```

Selected model:

```text
Weekly Naive
```

Recommended rule:

Do not promote XGBoost just because it wins by a tiny amount.

Use a minimum improvement threshold.

Example:

```text
XGBoost must improve MAE/WAPE by at least 3-5%
```

Also prefer models that perform consistently across several validation folds.

---

# 10. Data Quality Handling

Forecast accuracy depends on data quality.

The system should identify problematic days.

Examples:

```text
shop closed
incomplete day
stockout
missing transactions
abnormal sales
manual data issue
```

Example problem:

```text
Actual customer demand = 40
Product sold out in the afternoon
Recorded sales = 20
```

The model may incorrectly learn that demand was only 20.

Therefore stockout days should be flagged.

Recommended quality status:

```text
GOOD
INCOMPLETE
STOCKOUT
SHOP_CLOSED
OUTLIER
UNKNOWN
```

Avoid using unreliable days in model training/evaluation where appropriate.

---

# 11. Forecast Storage

Forecast results must be saved before actual sales occur.

Do not regenerate historical forecasts after seeing actual results.

Recommended tables:

```text
forecast_runs
forecast_run_points
forecast_quality_flags
```

## forecast_runs

Suggested fields:

```text
id
created_at
forecast_start
forecast_end
model_version
data_mode
history_hash
status
```

## forecast_run_points

Suggested fields:

```text
id
run_id
product_id
target_date

predicted_qty
lower_bound
upper_bound

model_name
lead_days
```

## forecast_quality_flags

Suggested fields:

```text
id
business_date
product_id
flag_type
reason
created_at
```

Forecast history should be append-only whenever possible.

---

# 12. Prediction Range

Do not display only a single forecast number.

Example:

```text
Americano

Forecast:
28 cups

Expected range:
23-34 cups

Model:
XGBoost

MAE:
2.6 cups

Historical data:
162 days
```

Prediction ranges can be calculated using historical forecast errors.

Do not describe empirical prediction ranges as guaranteed confidence intervals unless a proper statistical confidence interval method is implemented.

---

# 13. Forecast to Ingredient Requirement

This is one of the most important project features.

Forecasted menu quantity should be converted through recipes.

Example forecast:

```text
Latte       20
Cappuccino  15
Americano   30
```

Recipe:

```text
Latte
Coffee = 18 g
Milk   = 200 ml

Cappuccino
Coffee = 18 g
Milk   = 120 ml

Americano
Coffee = 18 g
```

Calculation:

```text
Coffee
= (20 * 18)
+ (15 * 18)
+ (30 * 18)

= 1170 g
```

Milk:

```text
(20 * 200)
+ (15 * 120)

= 5800 ml
```

Result:

```text
Required Coffee = 1170 g
Required Milk   = 5800 ml
```

---

# 14. Compare Forecast Requirements with Inventory

After calculating ingredient requirements, compare them with current stock.

Example:

Forecast requirement:

```text
Coffee = 1170 g
Milk   = 5800 ml
```

Current inventory:

```text
Coffee = 800 g
Milk   = 8000 ml
```

System recommendation:

```text
Coffee
Required: 1170 g
Available: 800 g
Shortage: 370 g

Recommendation:
Restock at least 370 g.
```

Milk:

```text
Required: 5800 ml
Available: 8000 ml

Status:
Sufficient
```

---

# 15. Preparation Recommendation

Create a recommendation service.

Input:

```text
Forecast
Recipes
Current Inventory
Safety Stock
```

Output:

```text
Preparation Recommendation
```

Example:

```text
Tomorrow forecast:

Americano   34 cups
Latte       29 cups
Thai Tea    24 cups

Ingredient warning:

Coffee Beans
Required: 1.43 kg
Available: 0.90 kg
Shortage: 0.53 kg

Milk
Required: 7.20 L
Available: 9.00 L
Status: Sufficient
```

Optional safety stock:

```text
recommended_requirement =
forecast_requirement * safety_factor
```

Example:

```text
safety_factor = 1.10
```

Do not hardcode safety factor without configuration.

---

# 16. Forecast Dashboard

The Forecast Dashboard should answer these questions quickly.

## Summary

Show:

```text
Tomorrow Forecast
142 cups

vs 7-day average
+12%
```

## Top predicted menu items

Example:

```text
Americano    34
Latte        29
Thai Tea     24
Cappuccino   18
Mocha        12
```

## Forecast Chart

Display:

```text
Actual vs Forecast
```

Prefer a line chart.

Support:

```text
1 day
7 days
30 days
```

## Product Forecast Table

Columns:

```text
Product
Forecast Qty
Lower
Upper
Model
MAE
Stock Status
```

## Ingredient Requirement

Columns:

```text
Ingredient
Required
Available
Shortage
Status
```

---

# 17. Forecast Accuracy Dashboard

Create a separate evaluation section.

Display:

```text
MAE
RMSE
WAPE
Bias
```

Allow viewing:

```text
overall
by product
by forecast horizon
by model
```

Example model comparison table:

| Model | MAE | RMSE | WAPE | Bias |
|---|---:|---:|---:|---:|
| Weekly Naive | 4.21 | 5.44 | 22.4% | -0.82 |
| Mean 7 | 3.82 | 4.98 | 19.6% | +0.37 |
| Mean 28 | 3.69 | 4.71 | 18.9% | +0.21 |
| SES | 3.74 | 4.80 | 19.2% | +0.31 |
| XGBoost | 3.12 | 4.17 | 16.1% | -0.12 |

These numbers are examples only.

Do NOT hardcode these example results.

All displayed metrics must be calculated from real stored forecasts and actual sales.

---

# 18. Forecast Worker

Keep forecasting as an automated scheduled process.

Recommended flow:

```text
02:00
  |
  v
Check previous business day closed
  |
  +-- No --> Skip / retry later
  |
  +-- Yes
       |
       v
Build/update daily demand
       |
       v
Validate data quality
       |
       v
Generate forecasts
       |
       +--> 1 day
       +--> 7 days
       +--> 30 days
       |
       v
Save forecast run
       |
       v
Calculate ingredient requirements
       |
       v
Dashboard
```

Also keep a manual:

```text
Generate Forecast
```

button for authorized users.

Manual generation must still create a proper forecast run and must not overwrite historical forecast records.

---

# 19. Suggested Architecture

Keep Machine Learning separate from the main Node backend.

Recommended:

```text
+-----------------------------+
| React / Vite                |
| Coffee Backoffice UI        |
+--------------+--------------+
               |
             REST
               |
               v
+-----------------------------+
| Node.js Backend             |
|                             |
| POS                         |
| Orders                      |
| Inventory                   |
| Recipes                     |
| Reports                     |
| Forecast API Proxy          |
+-------------+---------------+
              |
      +-------+--------+
      |                |
      v                v
 PostgreSQL         FastAPI
                       |
                       v
                Forecast Engine
                       |
               +-------+-------+
               |       |       |
               v       v       v
            Baseline   SES   XGBoost
```

Do not move ML logic into Node.js unless there is a very strong reason.

---

# 20. API Design

Recommended Forecast API routes.

## Generate forecast

```http
POST /forecast/generate
```

Example request:

```json
{
  "horizon": 7
}
```

## Latest forecast

```http
GET /forecast/latest?horizon=7
```

## Forecast history

```http
GET /forecast/runs
```

## Forecast run detail

```http
GET /forecast/runs/:id
```

## Accuracy

```http
GET /forecast/accuracy
```

Optional filters:

```text
product_id
start_date
end_date
horizon
model
```

## Ingredient requirements

```http
GET /forecast/requirements?run_id=<id>
```

## Preparation recommendations

```http
GET /forecast/recommendations?run_id=<id>
```

Reuse existing routes if the repository already has equivalent endpoints.

Do NOT create duplicate APIs unnecessarily.

Inspect existing code first.

---

# 21. Backend Rules

Forecast logic should follow these rules:

1. Only completed/fulfilled sales are training demand.
2. Cancelled transactions must not count as sales.
3. No future data leakage.
4. Forecasts must be stored before actual results.
5. Historical forecast runs must remain auditable.
6. Model selection must use time-based validation.
7. Baselines must remain available.
8. Machine Learning does not automatically win.
9. Stockout/closed-day quality issues must be handled.
10. Forecast results must connect to recipes and inventory.

---

# 22. Minimum Historical Data

Recommended minimum before trusting ML:

```text
28 days = minimum for basic forecasting
84 days = much better
120-180 days = preferred
```

If history is insufficient:

```text
do not fail
```

Use fallback baseline forecasting.

Example:

```text
history < 28 days
-> use simple mean / weekday mean / fallback method
```

The UI should be able to communicate:

```text
Limited historical data
Forecast confidence may be lower.
```

---

# 23. Real-World Data Collection

Record these fields whenever possible:

```text
business date
opening status
opening time
closing time

completed order quantity
menu item
price

stockout product
stockout time

promotion
holiday
special event
```

Never modify old forecast results just to make accuracy look better.

The evaluation must compare:

```text
forecast created before target date
vs
actual sales that happened later
```

---

# 24. Research / Final Project Evaluation

The final system should be able to answer:

## RQ1

How accurately can the system forecast daily demand for individual coffee shop menu items?

## RQ2

Can Machine Learning reduce forecast error compared with traditional/simple baseline methods?

## RQ3

Can forecast results be used to estimate ingredient requirements and support inventory preparation decisions?

---

# 25. Final Project Objectives

The project should demonstrate:

1. Coffee shop backoffice management.
2. Historical sales data collection.
3. Menu-level demand forecasting.
4. Comparison of multiple forecasting methods.
5. Automatic model selection.
6. Forecast accuracy evaluation.
7. Forecast-to-recipe conversion.
8. Ingredient requirement calculation.
9. Inventory shortage detection.
10. Preparation recommendations.

---

# 26. Development Phases

Implement in this order.

## Phase 1 — Audit Current Code

Inspect:

```text
frontend
backend
forecast-service
database schema
forecast docs
existing API routes
existing worker
```

Determine what already exists.

Do not rewrite working functionality unnecessarily.

---

## Phase 2 — Verify Demand Dataset

Ensure completed orders can be transformed into:

```text
date
product_id
quantity
price
quality status
```

Validate historical data.

---

## Phase 3 — Baseline Models

Verify or implement:

```text
Last Value
Last Matching Weekday
Mean 7
Mean 28
Weekday Mean
```

---

## Phase 4 — SES

Verify or implement:

```text
Simple Exponential Smoothing
```

---

## Phase 5 — XGBoost

Verify or implement XGBoost using leakage-safe features.

The model should not access future values.

---

## Phase 6 — Rolling Validation

Implement consistent evaluation across candidates.

Calculate:

```text
MAE
RMSE
WAPE
Bias
```

---

## Phase 7 — Model Selection

Select the most suitable model for each forecast scope/product.

Do not automatically prefer XGBoost.

---

## Phase 8 — Forecast Persistence

Store forecast runs and points.

Make historical predictions auditable.

---

## Phase 9 — Forecast Dashboard

Implement:

```text
summary cards
forecast chart
product forecast table
model information
prediction range
data quality indicators
```

---

## Phase 10 — Ingredient Planning

Connect:

```text
Forecast
   |
   v
Recipes
   |
   v
Ingredient requirements
```

---

## Phase 11 — Inventory Recommendation

Connect:

```text
Ingredient requirement
        |
        v
Current stock
        |
        v
Shortage / sufficient
        |
        v
Preparation recommendation
```

---

## Phase 12 — Evaluation Dashboard

Compare saved forecasts with actual sales.

Support analysis by:

```text
product
model
forecast horizon
date range
```

---

## Phase 13 — Real Data Experiment

Use real operational data.

Do not use demo data as final research evidence.

---

# 27. Important Restrictions

Do NOT add unnecessary advanced features until core forecasting is stable.

Do not prioritize:

```text
LSTM
Deep Learning
Neural Networks
IoT
dynamic pricing
customer recommendation
AI chatbot
multi-branch architecture
automatic purchasing
```

The project should prioritize:

```text
correct data
reproducible forecasts
real evaluation
clear business usefulness
```

A smaller system with reliable evaluation is better than a large system containing many unverified AI features.

---

# 28. Expected End-to-End Flow

Final system flow:

```text
Customer
   |
   v
POS / QR Order
   |
   v
Order
   |
   v
KDS
   |
   v
Completed Order
   |
   +------------------+
   |                  |
   v                  v
Stock Deduction   Sales History
                      |
                      v
                 Daily Demand
                      |
                      v
                Data Quality
                      |
                      v
              Forecast Candidates
                      |
          +-----------+-----------+
          |           |           |
          v           v           v
       Baseline      SES       XGBoost
          |           |           |
          +-----------+-----------+
                      |
                      v
              Rolling Validation
                      |
                      v
                 Best Model
                      |
                      v
              1 / 7 / 30 Day
                  Forecast
                      |
                      v
                    Recipe
                      |
                      v
             Ingredient Demand
                      |
                      v
                Current Stock
                      |
                      v
            Preparation Advice
```

---

# 29. Codex Instructions

When modifying the repository:

1. Inspect the repository before editing.
2. Read existing forecast documentation.
3. Identify existing implementation before creating new files.
4. Reuse existing database schema and routes where appropriate.
5. Do not break current POS, Order, Inventory, KDS, Recipe, or Report functions.
6. Keep forecasting service isolated in FastAPI if that is the current architecture.
7. Keep Node.js as the main application backend/API layer.
8. Keep PostgreSQL as the source of business data.
9. Avoid duplicate services.
10. Avoid hardcoded demo metrics.
11. Add migrations when database changes are needed.
12. Add clear error handling.
13. Add logging for forecast runs.
14. Add tests for critical calculations.
15. Keep code readable and suitable for a graduation project presentation.
16. Document important architectural decisions.
17. Make incremental changes instead of rewriting the whole project.

---

# 30. Testing Requirements

Add tests for at least:

```text
daily demand aggregation
cancelled-order exclusion
lag feature creation
rolling feature leakage prevention
model evaluation
model selection
forecast persistence
recipe conversion
ingredient requirement calculation
inventory shortage calculation
```

Example critical test:

```text
Forecast:
Latte = 10

Recipe:
Milk = 200 ml / cup

Expected:
Milk requirement = 2000 ml
```

Another:

```text
Required coffee = 1500 g
Available coffee = 1100 g

Expected shortage = 400 g
```

---

# 31. Definition of Done

The forecasting module is considered complete when:

- Historical completed sales can be aggregated correctly.
- Forecasts can be generated for menu items.
- 1/7/30-day horizons are supported.
- Multiple models are compared.
- Model selection is based on time-series validation.
- MAE/RMSE/WAPE/Bias are calculated from real data.
- Forecast runs are stored and auditable.
- Actual vs forecast can be displayed.
- Prediction ranges are available.
- Data quality problems can be flagged.
- Forecast results can be converted to ingredient requirements.
- Ingredient requirements can be compared with inventory.
- Shortage/preparation recommendations are displayed.
- Automated forecast worker runs safely.
- Manual forecast generation remains available.
- The module has basic automated tests.
- The implementation is documented well enough to explain during the final project defense.

---

# 32. Priority

Use this priority order:

```text
P0
Data correctness
Forecast history
No data leakage
Baseline models
Evaluation

P1
XGBoost
Model selection
Dashboard
Prediction range

P2
Recipe integration
Ingredient planning
Inventory recommendation

P3
Additional external features such as holiday/weather
```

Do not start P3 until P0-P2 are stable.

---

# Final Goal

The final project must demonstrate this complete idea:

> The coffee shop backoffice system does not only record past sales. It uses historical demand to forecast future menu demand, compares multiple forecasting methods, evaluates prediction accuracy, converts predicted menu sales into ingredient requirements, compares those requirements with inventory, and provides actionable preparation recommendations for shop management.

The forecasting module must remain practical, explainable, testable, and defensible as a graduation project.
