import { Body, Controller, Get, Header, Post } from '@nestjs/common';
import {
  StatlockerBrowserProbeRequest,
  StatlockerBrowserProbeResult,
  StatlockerBrowserService,
} from './statlocker-browser.service';
import { STATLOCKER_SITE_LIKE_PROBE_CLIENT_JS } from './statlocker-site-like.client';
import {
  StatlockerDiscoveryResult,
  StatlockerProbeRequest,
  StatlockerProbeResponse,
  StatlockerProbeService,
  StatlockerProbeTarget,
} from './statlocker-probe.service';
import { STATLOCKER_SITE_LIKE_PROBE_HTML } from './statlocker-site-like.ui';

@Controller('deadlock/tools/statlocker')
export class StatlockerProbeController {
  constructor(
    private readonly statlockerProbeService: StatlockerProbeService,
    private readonly statlockerBrowserService: StatlockerBrowserService,
  ) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  getUi(): string {
    return STATLOCKER_SITE_LIKE_PROBE_HTML;
  }

  @Get('client.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
  getClient(): string {
    return STATLOCKER_SITE_LIKE_PROBE_CLIENT_JS;
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

  @Post('browser-request')
  browserRequest(
    @Body() body: StatlockerBrowserProbeRequest,
  ): Promise<StatlockerBrowserProbeResult> {
    return this.statlockerBrowserService.probe(body);
  }
}
