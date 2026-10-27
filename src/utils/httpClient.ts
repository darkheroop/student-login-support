import http from 'http';
import https from 'https';
import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

/**
 * Reusable HTTP and HTTPS agents with persistent keep-alive connections.
 * Reusing sockets across requests avoids the 100-250ms TCP 3-way handshake
 * and TLS negotiation overhead on every upstream API call.
 */
export const httpKeepAliveAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
});

export const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
});

/**
 * Shared Axios instance configured with persistent connection agents
 * and optimized defaults for upstream communication.
 */
export const upstreamHttpClient: AxiosInstance = axios.create({
  httpAgent: httpKeepAliveAgent,
  httpsAgent: httpsKeepAliveAgent,
  timeout: config.upstreamTimeoutMs,
  validateStatus: () => true, // capture all status codes (2xx, 4xx, 5xx) without throwing
  maxRedirects: 5,
  transformResponse: [(data: unknown) => data], // Preserve raw response body
});
