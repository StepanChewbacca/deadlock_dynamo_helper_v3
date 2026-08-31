import { Module } from '@nestjs/common';
import { StatlockerProbeController } from './statlocker-probe.controller';
import { StatlockerProbeService } from './statlocker-probe.service';

@Module({
  controllers: [StatlockerProbeController],
  providers: [StatlockerProbeService],
})
export class StatlockerProbeModule {}
