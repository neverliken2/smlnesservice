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
          '**Auth flow (2-step + session):**\n' +
          '1. POST /auth/login {provider, username, password} → pre-select JWT (2m)\n' +
          '2. POST /auth/select-database {dataCode} + Bearer <preSelect> → guidCode\n' +
          '3. ใช้ guidCode กับ endpoint อื่น ๆ ผ่าน\n' +
          '   `Authorization: SmlGuid <provider>:<guidCode>`\n\n' +
          'Session อายุ 8 ชม. นับจาก last_access_time (sliding) — เก็บใน sml_guid',
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'preSelect',
      )
      .addApiKey(
        {
          type: 'apiKey',
          name: 'Authorization',
          in: 'header',
          description: 'SmlGuid <provider>:<guidCode>',
        },
        'smlGuid',
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
