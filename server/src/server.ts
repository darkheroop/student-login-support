import { config } from './config';
import app from './app';
import logger from './utils/logger';

const server = app.listen(config.port, () => {
  logger.info(`Student Support Server listening on port ${config.port} in ${config.nodeEnv} mode`);
  logger.info(`Authorized upstream configured target: ${config.upstreamBaseUrl}`);
});

const gracefulShutdown = () => {
  logger.info('Graceful shutdown initiated');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
