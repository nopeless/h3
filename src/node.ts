import type { IncomingMessage as NodeIncomingMessage, ServerResponse as NodeServerResponse } from "node:http";
import { App } from "./app";
import { createError, H3TypeError, sendError } from "./error";
import { createEvent, eventHandler, isEventHandler } from "./event";
import { EventHandler } from "./types";

// Node.js
export type { IncomingMessage as NodeIncomingMessage, ServerResponse as NodeServerResponse } from "node:http";
export type NodeListener = (req: NodeIncomingMessage, res: NodeServerResponse) => void
export type NodePromisifiedHandler = (req: NodeIncomingMessage, res: NodeServerResponse) => Promise<unknown>
export type NodeMiddleware = (req: NodeIncomingMessage, res: NodeServerResponse, next: (err?: Error) => unknown) => unknown

export const defineNodeListener = (handler: NodeListener) => handler;

export const defineNodeMiddleware = (middleware: NodeMiddleware) => middleware;

export function fromNodeMiddleware (handler: NodeListener | NodeMiddleware): EventHandler {
  if (isEventHandler(handler)) {
    return handler;
  }
  if (typeof handler !== "function") {
    throw new H3TypeError("Invalid handler. It should be a function:", handler);
  }

  return eventHandler(((event) => {
    return callNodeListener(handler, event.node.req, event.node.res);
  }) as EventHandler);
}

export function toNodeListener (app: App): NodeListener {
  const toNodeHandle: NodeListener = async function (req, res) {
    const event = createEvent(req, res);
    try {
      await app.handler(event);
    } catch (_error) {
      let error: ReturnType<typeof createError>;
      if (_error instanceof Error) {
        error = createError(_error);
      } else {
        error = createError(String(_error));
        error.cause = _error;
        error.unhandled = true;
      }

      if (app.options.onError) {
        await app.options.onError(error, event);
      } else {
        if (error.unhandled || error.fatal) {
          console.error("[h3]", error.fatal ? "[fatal]" : "[unhandled]", error); // eslint-disable-line no-console
        }
        sendError(event, error, !!app.options.debug);
      }
    }
  };
  return toNodeHandle;
}

export function promisifyNodeListener (handler: NodeListener | NodeMiddleware): NodePromisifiedHandler {
  return function (req: NodeIncomingMessage, res: NodeServerResponse) {
    return callNodeListener(handler, req, res);
  };
}

export function callNodeListener (handler: NodeMiddleware, req: NodeIncomingMessage, res: NodeServerResponse) {
  const isMiddleware = handler.length > 2;
  return new Promise((resolve, reject) => {
    const next = (err?: Error) => {
      if (isMiddleware) {
        res.off("close", next);
        res.off("error", next);
      }
      return err ? reject(createError(err)) : resolve(undefined);
    };
    try {
      const returned = handler(req, res, next);
      if (isMiddleware && returned === undefined) {
        res.once("close", next);
        res.once("error", next);
      } else {
        resolve(returned);
      }
    } catch (error) {
      next(error as Error);
    }
  });
}
