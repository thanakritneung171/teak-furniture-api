import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors(); // dev: allow the RN app + future admin web
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('Teak Production API')
    .setDescription('Central API for the teak furniture production system')
    .setVersion('0.1')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, doc); // Swagger UI at /docs, JSON at /docs-json

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`Teak API → http://localhost:${port}/api   ·   docs: http://localhost:${port}/docs`);
}
bootstrap();
