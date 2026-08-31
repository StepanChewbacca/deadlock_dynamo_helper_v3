import { Controller, Get } from '@nestjs/common';
import { RecommendationProspectiveCollectorV8Service } from './recommendation-prospective-collector-v8.service';

@Controller('deadlock/analysis/recommendation-v8-prospective')
export class RecommendationProspectiveCollectorV8Controller {
  constructor(private readonly collector: RecommendationProspectiveCollectorV8Service) {}

  @Get('status')
  getStatus() {
    return this.collector.getStatus();
  }
}
