import { loadConfig } from './config.js';
import { diagnose } from './diagnose.js';

// `node dist/diagnoseMain.js` — see diagnose.ts. Read-only; prints no secrets.
console.log(JSON.stringify(await diagnose(loadConfig()), null, 2));
