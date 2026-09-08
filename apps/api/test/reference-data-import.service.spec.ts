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
    const itemCatalogImportService = {
      getAvailableClientVersions: jest.fn().mockResolvedValue([6680, 6686]),
      importCatalogs: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ReferenceDataImportService(
      heroRepo as any,
      itemRepo as any,
      itemComponentRepo as any,
      catalogContentService as any,
      itemCatalogImportService as any,
    );
    return { service, heroRepo, itemRepo, catalogContentService, itemCatalogImportService };
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
      { params: { client_version: 6686 } },
    );
  });

  it('binds the immutable recommendation catalog to the exact latest client version', async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: [{ id: 1, name: 'Item' }] });
    const { service, catalogContentService, itemCatalogImportService } = createService();

    await service.importIfNeeded();

    expect(itemCatalogImportService.importCatalogs).toHaveBeenCalledWith({ clientVersions: [6686] });
    expect(catalogContentService.importAssetsSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      clientVersion: '6686',
      rulesetKey: 'client-6686',
    }));
  });
});
