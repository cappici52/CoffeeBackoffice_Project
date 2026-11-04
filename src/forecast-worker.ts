import { readConfig } from "./config.js";
import { connectDatabase } from "./db.js";
import { runForecastSchedule } from "./forecast-scheduler.js";
import { branchDatabase, inBranch } from './branch-context.js';

const config = readConfig();
const db = connectDatabase(config.DATABASE_URL);
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const branches=(await db.query('SELECT id,code FROM branches WHERE is_active ORDER BY code')).rows;
    for(const branch of branches) {
      try {
        const result=await inBranch({ids:[branch.id],write:true,master:false},()=>runForecastSchedule(branchDatabase(db),config));
        if(result.generated.length)console.log('Nightly forecasts completed',branch.code,result.generated.join(','));
      } catch {console.error('Branch forecast failed; retry next minute',branch.code);}
    }
  } catch (error) {
    console.error(
      "Forecast job failed; will retry next minute",
      error instanceof Error ? error.message : "Unknown error",
    );
  } finally {
    running = false;
  }
}
const timer = setInterval(() => void tick(), 60_000);
void tick();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    clearInterval(timer);
    void db.close().then(() => process.exit(0));
  });
