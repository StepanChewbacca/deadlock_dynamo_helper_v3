import { Body, Controller, Get, Header, Post } from '@nestjs/common';
import {
  StatlockerDiscoveryResult,
  StatlockerProbeRequest,
  StatlockerProbeResponse,
  StatlockerProbeService,
  StatlockerProbeTarget,
} from './statlocker-probe.service';
import { STATLOCKER_PROBE_HTML } from './statlocker-probe.ui';

@Controller('deadlock/tools/statlocker')
export class StatlockerProbeController {
  constructor(private readonly statlockerProbeService: StatlockerProbeService) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  getUi(): string {
    return STATLOCKER_PROBE_HTML;
  }

  @Get('presets')
  getPresets(): StatlockerProbeTarget[] {
    return this.statlockerProbeService.getTargets();
  }

  @Get('discover')
  discover(): Promise<StatlockerDiscoveryResult> {
    return this.statlockerProbeService.discoverEndpoints();
  }

  @Post('request')
  request(@Body() body: StatlockerProbeRequest): Promise<StatlockerProbeResponse> {
    return this.statlockerProbeService.request(body);
  }
}
