import { httpRouter } from 'convex/server';
import { options as extensionOptions, recordWatch } from './extensionExchange';

const http = httpRouter();

http.route({ path: '/extension/watch', method: 'POST', handler: recordWatch });
http.route({ path: '/extension/watch', method: 'OPTIONS', handler: extensionOptions });

export default http;
