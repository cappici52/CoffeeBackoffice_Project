# Coffee Sales v5 rolling evaluation

Dataset Coffee Sales — ihelon V21 · outlet index_1. Fixed trailing 90 calendar-day protocol; no operational model deployment.

## 1-day horizon

| Model | Product samples | MAE | RMSE | WAPE % | Bias | Total-day samples | Total MAE | Total RMSE | Total WAPE % | Total Bias |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Matching-weekday Naive | 696 | 1.1739 | 1.6794 | 80.6515 | -0.0675 | 87 | 3.8276 | 5.1917 | 32.8727 | -0.5402 |
| Last Value Naive | 696 | 1.2874 | 1.8945 | 88.4501 | 0.0057 | 87 | 5.2184 | 6.8313 | 44.8174 | 0.0460 |
| Moving Average 7 | 696 | 1.0476 | 1.4179 | 71.9778 | -0.0298 | 87 | 4.1638 | 5.2752 | 35.7602 | -0.2380 |
| Moving Average 28 | 696 | 1.0398 | 1.4170 | 71.4386 | -0.1242 | 87 | 4.2922 | 5.4836 | 36.8633 | -0.9938 |
| Weekday Average | 696 | 1.0366 | 1.4301 | 71.2241 | -0.1674 | 87 | 3.4598 | 4.7682 | 29.7137 | -1.3391 |
| SES | 696 | 1.0518 | 1.4222 | 72.2674 | -0.0351 | 87 | 4.2418 | 5.3776 | 36.4299 | -0.2810 |
| XGBoost | 696 | 1.0326 | 1.3578 | 70.9437 | -0.0152 | 87 | 3.6314 | 4.6015 | 31.1880 | -0.1217 |
| Automatic v5 | 696 | 1.0989 | 1.5487 | 75.5022 | -0.1344 | 87 | 4.1601 | 5.2905 | 35.7284 | -1.0755 |

| Product (automatic selection) | Samples | MAE | RMSE | WAPE % | Bias |
|---|---:|---:|---:|---:|---:|
| Americano | 87 | 1.6494 | 2.3342 | 57.1697 | -0.6381 |
| Americano with Milk | 87 | 1.5462 | 1.8961 | 66.2675 | -0.1100 |
| Cappuccino | 87 | 1.0397 | 1.3043 | 68.0113 | -0.0737 |
| Cocoa | 87 | 1.1491 | 1.5718 | 96.1308 | -0.1931 |
| Cortado | 87 | 0.6111 | 0.9112 | 118.1556 | 0.1205 |
| Espresso | 87 | 0.5879 | 0.7944 | 138.2243 | 0.0257 |
| Hot Chocolate | 87 | 0.9149 | 1.2511 | 104.7355 | -0.0005 |
| Latte | 87 | 1.2928 | 1.7165 | 68.5823 | -0.2063 |

## 7-day horizon

| Model | Product samples | MAE | RMSE | WAPE % | Bias | Total-day samples | Total MAE | Total RMSE | Total WAPE % | Total Bias |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Matching-weekday Naive | 648 | 1.1790 | 1.6988 | 78.9256 | -0.0833 | 81 | 3.8025 | 5.1711 | 31.8182 | -0.6667 |
| Last Value Naive | 648 | 1.2840 | 1.9165 | 85.9504 | -0.7315 | 81 | 6.4691 | 8.0508 | 54.1322 | -5.8519 |
| Moving Average 7 | 648 | 1.0411 | 1.4346 | 69.6907 | -0.0855 | 81 | 4.3813 | 5.4005 | 36.6616 | -0.6840 |
| Moving Average 28 | 648 | 1.0540 | 1.4632 | 70.5577 | -0.1820 | 81 | 4.5421 | 5.7273 | 38.0069 | -1.4561 |
| Weekday Average | 648 | 1.0401 | 1.4469 | 69.6281 | -0.1836 | 81 | 3.5185 | 4.8485 | 29.4421 | -1.4691 |
| SES | 648 | 1.0406 | 1.4548 | 69.6579 | -0.2245 | 81 | 4.4968 | 5.5704 | 37.6281 | -1.7960 |
| XGBoost | 648 | 1.0474 | 1.4040 | 70.1157 | -0.0803 | 81 | 3.8551 | 4.8174 | 32.2583 | -0.6421 |
| Automatic v5 | 648 | 1.1258 | 1.5952 | 75.3656 | -0.3165 | 81 | 4.6715 | 5.8608 | 39.0900 | -2.5322 |

| Product (automatic selection) | Samples | MAE | RMSE | WAPE % | Bias |
|---|---:|---:|---:|---:|---:|
| Americano | 81 | 1.7339 | 2.4877 | 57.0907 | -1.1409 |
| Americano with Milk | 81 | 1.3363 | 1.6542 | 55.2230 | -0.3986 |
| Cappuccino | 81 | 1.2307 | 1.5729 | 78.4929 | -0.5213 |
| Cocoa | 81 | 1.1688 | 1.6084 | 93.7317 | -0.1818 |
| Cortado | 81 | 0.6031 | 0.9039 | 132.0216 | 0.1151 |
| Espresso | 81 | 0.5961 | 0.8752 | 146.3212 | -0.0943 |
| Hot Chocolate | 81 | 0.9223 | 1.2428 | 103.7569 | 0.0976 |
| Latte | 81 | 1.4156 | 1.8006 | 73.5032 | -0.4080 |

## 30-day horizon

| Model | Product samples | MAE | RMSE | WAPE % | Bias | Total-day samples | Total MAE | Total RMSE | Total WAPE % | Total Bias |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Matching-weekday Naive | 696 | 1.2342 | 1.7952 | 84.7976 | -0.0704 | 87 | 4.1954 | 5.6253 | 36.0316 | -0.5632 |
| Last Value Naive | 696 | 1.4195 | 2.2425 | 97.5321 | 0.2299 | 87 | 6.4828 | 8.3872 | 55.6762 | 1.8391 |
| Moving Average 7 | 696 | 1.1529 | 1.6135 | 79.2088 | -0.0331 | 87 | 4.7375 | 6.3419 | 40.6870 | -0.2651 |
| Moving Average 28 | 696 | 1.0857 | 1.5429 | 74.5939 | -0.2423 | 87 | 4.7612 | 6.1928 | 40.8912 | -1.9387 |
| Weekday Average | 696 | 1.0686 | 1.5201 | 73.4205 | -0.2611 | 87 | 3.8592 | 5.5097 | 33.1441 | -2.0891 |
| SES | 696 | 1.1496 | 1.6154 | 78.9882 | -0.0007 | 87 | 4.8886 | 6.5417 | 41.9852 | -0.0054 |
| XGBoost | 696 | 1.1895 | 1.5973 | 81.7256 | 0.1001 | 87 | 5.6567 | 6.9690 | 48.5820 | 0.8006 |
| Automatic v5 | 696 | 1.2167 | 1.6912 | 83.5948 | 0.0868 | 87 | 5.0343 | 6.6820 | 43.2366 | 0.6943 |

| Product (automatic selection) | Samples | MAE | RMSE | WAPE % | Bias |
|---|---:|---:|---:|---:|---:|
| Americano | 87 | 2.1141 | 2.9402 | 73.2781 | -0.5574 |
| Americano with Milk | 87 | 1.2552 | 1.5743 | 53.7946 | -0.0865 |
| Cappuccino | 87 | 1.1865 | 1.5327 | 77.6105 | 0.1974 |
| Cocoa | 87 | 1.3527 | 1.6923 | 113.1606 | 0.2503 |
| Cortado | 87 | 1.0920 | 1.3939 | 211.1289 | 0.8634 |
| Espresso | 87 | 0.5287 | 0.7428 | 124.3243 | 0.2529 |
| Hot Chocolate | 87 | 0.8604 | 1.0666 | 98.4961 | 0.2835 |
| Latte | 87 | 1.3438 | 1.7067 | 71.2866 | -0.5092 |

Scores across datasets or horizon populations are not proof of model improvement. Aggregate errors can cancel product errors. Missing dates remain unknown. This vending-machine source does not validate a new CoffeeBackoffice shop.
