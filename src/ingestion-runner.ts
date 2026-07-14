import './Config/Env.Config.js';
import { logger } from './Config/Logger.Config.js';
import { runWorker } from './Ingestion/Worker.js';

runWorker()
  .then((result) => {
    logger.info(result, 'ingestion complete');
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, 'ingestion worker crashed');
    process.exit(1);
  });
