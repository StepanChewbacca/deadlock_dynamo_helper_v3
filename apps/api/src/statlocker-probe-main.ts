import { NestFactory } from '@nestjs/core';
import { StatlockerProbeModule } from './statlocker-probe/statlocker-probe.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(StatlockerProbeModule);
  app.enableCors();

  const port = Number(process.env.STATLOCKER_PROBE_PORT || '3000');
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
