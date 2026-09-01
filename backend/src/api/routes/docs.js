import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Router } from 'express';
import helmet from 'helmet';
import { createOpenApiDocument } from '../openapi/document.js';

export const DOCUMENT_PATH = '/openapi.json';

const UI_PATH = '/docs';

// Resolved from the installed package rather than fetched from a CDN: a
// deployment on a closed network has to be able to open this page.
const SWAGGER_UI_DIST = dirname(fileURLToPath(import.meta.resolve('swagger-ui-dist/package.json')));

const INITIALIZER_PATH = `${UI_PATH}/initializer.js`;

const initializer = `window.ui = SwaggerUIBundle({
  url: '${DOCUMENT_PATH}',
  dom_id: '#swagger-ui',
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
  layout: 'BaseLayout',
  deepLinking: true,
});
`;

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>hook-tracker API</title>
    <link rel="icon" href="${UI_PATH}/favicon-32x32.png" />
    <link rel="stylesheet" href="${UI_PATH}/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${UI_PATH}/swagger-ui-bundle.js"></script>
    <script src="${UI_PATH}/swagger-ui-standalone-preset.js"></script>
    <script src="${INITIALIZER_PATH}"></script>
  </body>
</html>
`;

// The page is the only HTML this API serves, and the surrounding helmet default
// would upgrade its asset requests to https — which a plain-HTTP deployment
// behind the compose network cannot answer. The directives are narrowed to what
// Swagger UI actually loads instead of relaxing the default for the whole app.
function docsSecurityPolicy() {
  return helmet.contentSecurityPolicy({
    useDefaults: false,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'self'"],
    },
  });
}

export function createDocsRouter({ document = createOpenApiDocument() } = {}) {
  const router = Router();
  const serialised = JSON.stringify(document);

  router.get(DOCUMENT_PATH, (req, res) => {
    res.status(200).type('application/json').send(serialised);
  });

  router.get(UI_PATH, docsSecurityPolicy(), (req, res) => {
    res.status(200).type('text/html').send(page);
  });

  router.get(INITIALIZER_PATH, docsSecurityPolicy(), (req, res) => {
    res.status(200).type('text/javascript').send(initializer);
  });

  router.use(UI_PATH, docsSecurityPolicy(), express.static(SWAGGER_UI_DIST, { index: false }));

  return router;
}
