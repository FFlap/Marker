import { httpRouter } from 'convex/server';
import { options as avatarOptions, upload as uploadAvatar } from './avatarUpload';
import { options as extensionOptions, recordWatch } from './extensionExchange';

const http = httpRouter();

http.route({ path: '/avatar/upload', method: 'POST', handler: uploadAvatar });
http.route({ path: '/avatar/upload', method: 'OPTIONS', handler: avatarOptions });
http.route({ path: '/extension/watch', method: 'POST', handler: recordWatch });
http.route({ path: '/extension/watch', method: 'OPTIONS', handler: extensionOptions });

export default http;
