import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Global API prefix — endpoint ทุกตัวอยู่ใต้ /api/v1
  // ยกเว้น /health (liveness probe) + / (default smoke)
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', '/'],
  });

  // หมายเหตุ: validation ใช้ Zod parse manual ใน controller — ไม่ใช้ ValidationPipe
  // (ValidationPipe ผูกกับ class-validator ซึ่ง stack เราไม่พึ่ง)

  // Graceful shutdown — เรียก onModuleDestroy ใน PoolManagerService
  app.enableShutdownHooks();

  // Swagger UI — disable เฉพาะ production
  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('smlnesservice API')
      .setDescription(
        'API Gateway สำหรับ SML ERP Web/Mobile clients\n\n' +
          'ทุก endpoint ใต้ /api/v1 ต้องมี header:\n' +
          '- `X-API-Key`: raw key (เก็บที่ฝั่ง client)\n' +
          '- `X-Provider`: provider code เช่น "demo"\n\n' +
          'หลัง /auth/select-database จะได้ JWT — ใช้ `Authorization: Bearer <token>` เพิ่ม',
      )
      .setVersion('1.0')
      .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'apiKey')
      .addApiKey(
        { type: 'apiKey', name: 'X-Provider', in: 'header' },
        'provider',
      )
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'jwt',
      )
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  Logger.log(
    `🚀 smlnesservice listening on http://localhost:${port}`,
    'Bootstrap',
  );
  if (process.env.NODE_ENV !== 'production') {
    Logger.log(`📘 Swagger UI: http://localhost:${port}/api/docs`, 'Bootstrap');
  }
}
void bootstrap();
