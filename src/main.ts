import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Global API prefix — endpoint ทุกตัวอยู่ใต้ /api/v1
  app.setGlobalPrefix('api/v1', {
    exclude: ['health', '/'],
  });

  // Validation pipe (สำหรับ class-validator DTOs ภายหลัง)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Graceful shutdown — เรียก onModuleDestroy ใน PoolManagerService
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  Logger.log(`🚀 smlnesservice listening on http://localhost:${port}`, 'Bootstrap');
}
void bootstrap();
