import { Request, Response, NextFunction } from 'express';

// Type-safe version: Promise<void> instead of any
type AsyncFn = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export const catchAsync = (fn: AsyncFn) => {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
};
