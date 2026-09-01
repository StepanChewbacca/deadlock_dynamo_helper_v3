import axios from 'axios';
import { ReferenceDataImportService } from '../src/deadlock-live/reference-data-import.service';

describe('ReferenceDataImportService', () => {
  let previousDeadlockApiKey: string | undefined;

  beforeEach(() => {
    previousDeadlockApiKey = process.env.DEADLOCK_API_KEY;
    delete process.env.DEADLOCK_API_KEY;
    jest.spyOn(axios, 'get').mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousDeadlockApiKey === undefined) {
      delete process.env.DEADLOCK_API_KEY;
    } else {
      process.env.DEADLOCK_API_KEY = previousDeadlockApiKey;
    }
  });

  function createService() {
    const heroRepo = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const itemRepo = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const itemComponentRepo = {
      create: jest.fn((value) => value),
      save: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn(() => ({
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      })),
    };
    const catalogContentService = {
      importAssetsSnapshot: jest.fn(),
    };
    const service = new ReferenceDataImportService(
      heroRepo as any,
      itemRepo as any,
      itemComponentRepo as any,
      catalogContentService as any,
    );
    return { service, heroRepo, itemRepo };
  }

  it('imports heroes and items from the embedded seed when tables are empty', async () => {
    const { service, heroRepo, itemRepo } = createService();

    await service.importIfNeeded();

    expect(heroRepo.save).toHaveBeenCalled();
    expect(itemRepo.save).toHaveBeenCalled();
    expect(heroRepo.create).toHaveBeenCalled();
    expect(itemRepo.create).toHaveBeenCalled();
  });

  it('imports reference data even when no local json files exist', async () => {
    const { service, heroRepo, itemRepo } = createService();

    await service.importIfNeeded();

    expect(heroRepo.save).toHaveBeenCalled();
    expect(itemRepo.save).toHaveBeenCalled();
  });

  it('attempts the assets catalog bootstrap when DEADLOCK_API_KEY is not configured', async () => {
    const { service } = createService();

    await service.importIfNeeded();

    expect(axios.get).toHaveBeenCalledWith(
      'https://api.deadlock-api.com/v1/assets/items',
      {},
    );
  });
});
