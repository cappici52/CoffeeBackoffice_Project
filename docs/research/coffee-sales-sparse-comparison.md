# Sparse-demand experiment: identical frozen rolling periods

All columns use the unchanged recorded-sales outcomes and original fold masks. These are retrospective research comparisons, not new-shop validation.

## 1-day horizon

| Method | Product pairs | MAE | RMSE | WAPE % | Bias | Total days | Total MAE | Total RMSE | Total WAPE % | Total Bias |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| auto | 696 | 1.0989 | 1.5487 | 75.5022 | -0.1344 | 87 | 4.1601 | 5.2905 | 35.7284 | -1.0755 |
| weekly-naive-v1 | 696 | 1.1739 | 1.6794 | 80.6515 | -0.0675 | 87 | 3.8276 | 5.1917 | 32.8727 | -0.5402 |
| last-value-v1 | 696 | 1.2874 | 1.8945 | 88.4501 | 0.0057 | 87 | 5.2184 | 6.8313 | 44.8174 | 0.0460 |
| mean-7-v1 | 696 | 1.0476 | 1.4179 | 71.9778 | -0.0298 | 87 | 4.1638 | 5.2752 | 35.7602 | -0.2380 |
| mean-28-v1 | 696 | 1.0398 | 1.4170 | 71.4386 | -0.1242 | 87 | 4.2922 | 5.4836 | 36.8633 | -0.9938 |
| weekday-mean-v1 | 696 | 1.0366 | 1.4301 | 71.2241 | -0.1674 | 87 | 3.4598 | 4.7682 | 29.7137 | -1.3391 |
| ses-v1 | 696 | 1.0518 | 1.4222 | 72.2674 | -0.0351 | 87 | 4.2418 | 5.3776 | 36.4299 | -0.2810 |
| direct | 696 | 1.0326 | 1.3578 | 70.9437 | -0.0152 | 87 | 3.6314 | 4.6015 | 31.1880 | -0.1217 |
| croston-a10 | 696 | 1.0525 | 1.4132 | 72.3129 | -0.0975 | 87 | 4.2918 | 5.4214 | 36.8594 | -0.7799 |
| sba-a10 | 696 | 1.0475 | 1.4215 | 71.9693 | -0.1654 | 87 | 4.3773 | 5.5192 | 37.5934 | -1.3231 |
| tsb-a10-b10 | 696 | 1.0367 | 1.4076 | 71.2289 | -0.1016 | 87 | 4.2819 | 5.4174 | 36.7744 | -0.8130 |
| td-mean28-share28 | 696 | 1.0398 | 1.4170 | 71.4389 | -0.1242 | 87 | 4.2923 | 5.4837 | 36.8642 | -0.9938 |
| td-weekday-share28 | 696 | 0.9914 | 1.3546 | 68.1143 | -0.1674 | 87 | 3.4598 | 4.7682 | 29.7137 | -1.3391 |
| td-weekday-share-weekday56 | 696 | 1.0386 | 1.4374 | 71.3568 | -0.1674 | 87 | 3.4598 | 4.7682 | 29.7137 | -1.3391 |
| past-selected-stat | 696 | 1.0348 | 1.4043 | 71.0955 | -0.0690 | 87 | 4.1661 | 5.3126 | 35.7804 | -0.5522 |
| global-xgb-onehot | 696 | 1.0223 | 1.3542 | 70.2383 | -0.0383 | 87 | 3.6179 | 4.5733 | 31.0719 | -0.3066 |

| Product | v5 selection counts (one vote/origin) |
|---|---|
| Americano | mean-28-v1: 26, mean-7-v1: 22, weekday-mean-v1: 18, weekly-naive-v1: 17, last-value-v1: 4, global-xgb-ordinal: 2, ses-v1: 1 |
| Americano with Milk | ses-v1: 26, mean-28-v1: 25, weekday-mean-v1: 18, last-value-v1: 12, weekly-naive-v1: 8, global-xgb-ordinal: 1 |
| Cappuccino | mean-28-v1: 51, weekday-mean-v1: 22, ses-v1: 7, global-xgb-ordinal: 6, mean-7-v1: 4 |
| Cocoa | mean-28-v1: 28, last-value-v1: 25, weekly-naive-v1: 13, weekday-mean-v1: 10, mean-7-v1: 9, ses-v1: 5 |
| Cortado | weekly-naive-v1: 32, mean-28-v1: 19, last-value-v1: 18, mean-7-v1: 12, ses-v1: 6, weekday-mean-v1: 3 |
| Espresso | weekday-mean-v1: 30, weekly-naive-v1: 24, mean-7-v1: 12, last-value-v1: 11, ses-v1: 9, mean-28-v1: 4 |
| Hot Chocolate | last-value-v1: 25, mean-7-v1: 20, mean-28-v1: 15, global-xgb-ordinal: 13, weekly-naive-v1: 13, ses-v1: 2, weekday-mean-v1: 2 |
| Latte | mean-7-v1: 30, mean-28-v1: 27, weekday-mean-v1: 15, last-value-v1: 6, global-xgb-ordinal: 4, ses-v1: 4, weekly-naive-v1: 4 |

## 7-day horizon

| Method | Product pairs | MAE | RMSE | WAPE % | Bias | Total days | Total MAE | Total RMSE | Total WAPE % | Total Bias |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| auto | 648 | 1.1258 | 1.5952 | 75.3656 | -0.3165 | 81 | 4.6715 | 5.8608 | 39.0900 | -2.5322 |
| weekly-naive-v1 | 648 | 1.1790 | 1.6988 | 78.9256 | -0.0833 | 81 | 3.8025 | 5.1711 | 31.8182 | -0.6667 |
| last-value-v1 | 648 | 1.2840 | 1.9165 | 85.9504 | -0.7315 | 81 | 6.4691 | 8.0508 | 54.1322 | -5.8519 |
| mean-7-v1 | 648 | 1.0411 | 1.4346 | 69.6907 | -0.0855 | 81 | 4.3813 | 5.4005 | 36.6616 | -0.6840 |
| mean-28-v1 | 648 | 1.0540 | 1.4632 | 70.5577 | -0.1820 | 81 | 4.5421 | 5.7273 | 38.0069 | -1.4561 |
| weekday-mean-v1 | 648 | 1.0401 | 1.4469 | 69.6281 | -0.1836 | 81 | 3.5185 | 4.8485 | 29.4421 | -1.4691 |
| ses-v1 | 648 | 1.0406 | 1.4548 | 69.6579 | -0.2245 | 81 | 4.4968 | 5.5704 | 37.6281 | -1.7960 |
| direct | 648 | 1.0474 | 1.4040 | 70.1157 | -0.0803 | 81 | 3.8551 | 4.8174 | 32.2583 | -0.6421 |
| croston-a10 | 648 | 1.0558 | 1.4432 | 70.6751 | -0.1670 | 81 | 4.4426 | 5.5807 | 37.1747 | -1.3361 |
| sba-a10 | 648 | 1.0529 | 1.4573 | 70.4857 | -0.2334 | 81 | 4.5570 | 5.7311 | 38.1316 | -1.8671 |
| tsb-a10-b10 | 648 | 1.0399 | 1.4477 | 69.6140 | -0.2073 | 81 | 4.5196 | 5.6472 | 37.8192 | -1.6584 |
| td-mean28-share28 | 648 | 1.0540 | 1.4632 | 70.5573 | -0.1820 | 81 | 4.5420 | 5.7272 | 38.0063 | -1.4560 |
| td-weekday-share28 | 648 | 1.0088 | 1.3935 | 67.5329 | -0.1836 | 81 | 3.5185 | 4.8485 | 29.4421 | -1.4691 |
| td-weekday-share-weekday56 | 648 | 1.0485 | 1.4587 | 70.1903 | -0.1836 | 81 | 3.5185 | 4.8485 | 29.4421 | -1.4691 |
| past-selected-stat | 648 | 1.0526 | 1.4664 | 70.4642 | -0.2376 | 81 | 4.6026 | 5.7721 | 38.5135 | -1.9004 |
| global-xgb-onehot | 648 | 1.0345 | 1.3959 | 69.2544 | -0.1124 | 81 | 3.7498 | 4.7375 | 31.3772 | -0.8993 |

| Product | v5 selection counts (one vote/origin) |
|---|---|
| Americano | mean-28-v1: 6, mean-7-v1: 2, weekly-naive-v1: 2, ses-v1: 1, last-value-v1: 1 |
| Americano with Milk | mean-28-v1: 5, last-value-v1: 4, ses-v1: 3 |
| Cappuccino | mean-28-v1: 5, last-value-v1: 4, ses-v1: 2, weekday-mean-v1: 1 |
| Cocoa | mean-7-v1: 3, weekday-mean-v1: 3, mean-28-v1: 2, last-value-v1: 2, weekly-naive-v1: 1, ses-v1: 1 |
| Cortado | weekly-naive-v1: 5, last-value-v1: 3, ses-v1: 2, mean-28-v1: 1, mean-7-v1: 1 |
| Espresso | last-value-v1: 8, weekday-mean-v1: 3, mean-7-v1: 1 |
| Hot Chocolate | mean-7-v1: 5, mean-28-v1: 3, global-xgb-ordinal: 2, last-value-v1: 2 |
| Latte | global-xgb-ordinal: 3, mean-7-v1: 3, mean-28-v1: 3, ses-v1: 1, weekday-mean-v1: 1, last-value-v1: 1 |

## 30-day horizon

| Method | Product pairs | MAE | RMSE | WAPE % | Bias | Total days | Total MAE | Total RMSE | Total WAPE % | Total Bias |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| auto | 696 | 1.2167 | 1.6912 | 83.5948 | 0.0868 | 87 | 5.0343 | 6.6820 | 43.2366 | 0.6943 |
| weekly-naive-v1 | 696 | 1.2342 | 1.7952 | 84.7976 | -0.0704 | 87 | 4.1954 | 5.6253 | 36.0316 | -0.5632 |
| last-value-v1 | 696 | 1.4195 | 2.2425 | 97.5321 | 0.2299 | 87 | 6.4828 | 8.3872 | 55.6762 | 1.8391 |
| mean-7-v1 | 696 | 1.1529 | 1.6135 | 79.2088 | -0.0331 | 87 | 4.7375 | 6.3419 | 40.6870 | -0.2651 |
| mean-28-v1 | 696 | 1.0857 | 1.5429 | 74.5939 | -0.2423 | 87 | 4.7612 | 6.1928 | 40.8912 | -1.9387 |
| weekday-mean-v1 | 696 | 1.0686 | 1.5201 | 73.4205 | -0.2611 | 87 | 3.8592 | 5.5097 | 33.1441 | -2.0891 |
| ses-v1 | 696 | 1.1496 | 1.6154 | 78.9882 | -0.0007 | 87 | 4.8886 | 6.5417 | 41.9852 | -0.0054 |
| direct | 696 | 1.1895 | 1.5973 | 81.7256 | 0.1001 | 87 | 5.6567 | 6.9690 | 48.5820 | 0.8006 |
| croston-a10 | 696 | 1.0988 | 1.5336 | 75.4970 | -0.1660 | 87 | 4.6958 | 6.1004 | 40.3288 | -1.3282 |
| sba-a10 | 696 | 1.0935 | 1.5391 | 75.1337 | -0.2305 | 87 | 4.7828 | 6.1955 | 41.0762 | -1.8443 |
| tsb-a10-b10 | 696 | 1.0888 | 1.5320 | 74.8103 | -0.1461 | 87 | 4.6871 | 6.1073 | 40.2547 | -1.1684 |
| td-mean28-share28 | 696 | 1.0857 | 1.5429 | 74.5945 | -0.2424 | 87 | 4.7612 | 6.1928 | 40.8906 | -1.9390 |
| td-weekday-share28 | 696 | 1.0472 | 1.4939 | 71.9508 | -0.2611 | 87 | 3.8592 | 5.5097 | 33.1441 | -2.0891 |
| td-weekday-share-weekday56 | 696 | 1.0834 | 1.5382 | 74.4401 | -0.2611 | 87 | 3.8592 | 5.5097 | 33.1441 | -2.0891 |
| past-selected-stat | 696 | 1.0935 | 1.5391 | 75.1337 | -0.2305 | 87 | 4.7828 | 6.1955 | 41.0762 | -1.8443 |
| global-xgb-onehot | 696 | 1.1648 | 1.5796 | 80.0321 | 0.0556 | 87 | 5.5258 | 6.7968 | 47.4576 | 0.4446 |

| Product | v5 selection counts (one vote/origin) |
|---|---|
| Americano | mean-7-v1: 3 |
| Americano with Milk | mean-28-v1: 1, ses-v1: 1, mean-7-v1: 1 |
| Cappuccino | mean-28-v1: 2, last-value-v1: 1 |
| Cocoa | ses-v1: 2, last-value-v1: 1 |
| Cortado | last-value-v1: 1, ses-v1: 1, mean-28-v1: 1 |
| Espresso | last-value-v1: 3 |
| Hot Chocolate | mean-7-v1: 2, last-value-v1: 1 |
| Latte | mean-28-v1: 1, last-value-v1: 1, mean-7-v1: 1 |
