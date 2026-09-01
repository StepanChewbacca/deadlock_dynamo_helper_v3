import { Module } from '@nestjs/common';
import { StatlockerBrowserService } from './statlocker-browser.service';
import { StatlockerProbeController } from './statlocker-probe.controller';
import { StatlockerProbeService } from './statlocker-probe.service';

@Module({
  controllers: [StatlockerProbeController],
  providers: [StatlockerProbeService, StatlockerBrowserService],
})
export class StatlockerProbeModule {}
