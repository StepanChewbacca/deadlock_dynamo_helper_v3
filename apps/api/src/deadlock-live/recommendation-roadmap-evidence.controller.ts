import { timingSafeEqual } from 'crypto';
import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { RecommendationRoadmapEvidenceRecordV1 } from '@deadlock-live-probe/shared';
import { RecommendationRoadmapEvidenceService } from './recommendation-roadmap-evidence.service';

@Controller('deadlock-live/recommendation-roadmap/v1')
export class RecommendationRoadmapEvidenceController {
  constructor(private readonly evidence: RecommendationRoadmapEvidenceService) {}

  @Post('evidence')
  append(
    @Headers('x-recommendation-roadmap-token') token: string | undefined,
    @Body() record: RecommendationRoadmapEvidenceRecordV1,
  ) {
    requireRoadmapToken(token);
    return this.evidence.append(record);
  }

  @Get('report')
  report(@Headers('x-recommendation-roadmap-token') token: string | undefined) {
    requireRoadmapToken(token);
    return this.evidence.report();
  }
}

function requireRoadmapToken(provided: string | undefined): void {
  const expected = process.env.RECOMMENDATION_ROADMAP_EVIDENCE_TOKEN;
  if (!expected || !provided || !safeEqual(expected, provided)) {
    throw new Error('Recommendation roadmap evidence endpoint is disabled or unauthorized');
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
