import crypto from 'node:crypto';
import { Controller, Ctx, Cursor, AomCursor, AomRoute, Middleware, OnInstance } from "@aom-js/router";
import { Route, AomApi, This } from "@aom-js/router";
//
import { type HttpCtx, type HttpRequest } from "../../types";
import { AomLoggerEngine } from "./types";
//
class LoggerAttachments {
  result: any;

  constructor(constructor: any) {
    this.result = () => AomApi.instance(constructor);
  }

  toJSON() {
    return Reflect.apply(this.result, null, []);
  }
}

@Controller()
export class Logger {

  static ENGINE: AomLoggerEngine = console;

  // request!: HttpRequest; // данные запроса

  idempotenceKey: string; // уникальный ключ запроса

  currentDate!: Date; // дата записи

  startDate: Date; // время начала запроса

  finishDate!: Date; // время завершения запроса

  route!: AomRoute; // выполняемый маршрут

  status!: number; // итоговый статус

  lifetime!: number; // время жизни запроса

  duration!: number; // длительность выполнения запроса

  error!: Error; // ошибка в запросе

  attachments: Record<string, {}> = {}; // приложения

  constructor() {
    this.idempotenceKey = `${Date.now()}:${crypto.randomBytes(24).toString('base64')}`;
    this.startDate = new Date();
    this.lifetime = 0;
    this.duration = 0;
  }

  @Middleware()
  static async Init(@Route() route: AomRoute, @This() self: Logger, @Ctx() ctx: HttpCtx) {
    // в общем случае onerror всегда выполняется в конце, что позволяет мне зафиксировать время окончания запроса
    // и статус его завершения, и, в случае ошибки, саму ошибку
    const finishHandler = () => {
      self.currentDate = new Date();
      self.finishDate = new Date();
      self.status = ctx.res.statusCode;
      self.lifetime = +self.currentDate - +self.startDate; // время жизни запроса
      self.duration = +self.finishDate - +self.startDate; // длительность запроса

      if (self.status !== 200) {
        // log.error = ctx.res.body as Error; !! todo посмотреть как сделать!
        this.ENGINE.error("Request error:", self);
      } else {
        this.ENGINE.info("Request success:", self);
      }
    };

    ctx.res.on("finish", finishHandler);
    ctx.res.on("error", finishHandler);

    self.currentDate = new Date();

    // self.request = ctx.req;

    self.route = route;

    Object.assign(ctx, { log: self });
    this.ENGINE.info("Logger initiated:", self);
  }

  @Middleware()
  static async Attach(@Cursor() cursor: AomCursor, @This() self: Logger) {
    const { origin } = cursor;
    // добавить в приложения к логированию указанный middleware/enpoint
    // извлекает origin, приложенный к курсору, и создает сущность, которая в момент составления лога извлекает
    // значение из stateMap
    // /*
    self.attachments[origin._.target.name] = new LoggerAttachments(origin._.target);
  }

  @Middleware()
  static async Watch(@This() self: Logger, @Cursor() cursor: AomCursor) {
    self.currentDate = new Date();
    self.lifetime = +self.currentDate - +self.startDate;
    const { origin } = cursor;
    const fragment = {
      prefix: cursor.prefix,
      constructor: origin._.target.name,
      property: origin._.property,
    };
    this.ENGINE.debug("Request fragment:", { ...self, fragment });
  }
}
