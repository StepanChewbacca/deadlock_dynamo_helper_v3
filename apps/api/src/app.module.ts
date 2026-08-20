import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeadlockLiveModule } from './deadlock-live/deadlock-live.module';
import { CrawlerRun } from './deadlock-live/entities/crawler-run.entity';
import { CrawlerState } from './deadlock-live/entities/crawler-state.entity';
import { Hero } from './deadlock-live/entities/hero.entity';
import { ItemCatalogItem } from './deadlock-live/entities/item-catalog-item.entity';
import { ItemCatalogRecipe } from './deadlock-live/entities/item-catalog-recipe.entity';
import { ItemCatalogVersion } from './deadlock-live/entities/item-catalog-version.entity';
import { ItemComponent } from './deadlock-live/entities/item-component.entity';
import { Item } from './deadlock-live/entities/item.entity';
import { Match } from './deadlock-live/entities/match.entity';
import { MatchPlayerItem } from './deadlock-live/entities/match-player-item.entity';
import { MatchPlayer } from './deadlock-live/entities/match-player.entity';
import { MatchPlayerSkillUpgrade } from './deadlock-live/entities/match-player-skill-upgrade.entity';
import { ShadowModeDecision } from './deadlock-live/entities/shadow-mode-decision.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'deadlock_builds',
      entities: [
        Match,
        MatchPlayer,
        MatchPlayerItem,
        MatchPlayerSkillUpgrade,
        Hero,
        Item,
        ItemComponent,
        ItemCatalogVersion,
        ItemCatalogItem,
        ItemCatalogRecipe,
        CrawlerRun,
        CrawlerState,
        ShadowModeDecision,
      ],
      synchronize: true,
    }),
    DeadlockLiveModule,
  ],
})
export class AppModule {}
