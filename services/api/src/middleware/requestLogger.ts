import type { NextFunction, Request, Response } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();

  res.on('finish', () => {
    const routePath = req.route?.path;
    const requestPath = `${req.baseUrl}${typeof routePath === 'string' ? routePath : ''}`;
    console.info(`${req.method} ${requestPath} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });

  next();
}
