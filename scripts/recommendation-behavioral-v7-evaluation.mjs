export const V7_SUPPORT_PROBABILITY = 0.01;
export const V7_PROPENSITY_FLOORS = [0.005, 0.01, 0.02];
export const V7_MAJOR_GROUP_MIN_DECISIONS = 100;

export function selectBehavioralV7ChoiceSet(row) {
  const actionKeys = row.choiceSet?.behavioralChoiceSetActionKeys;
  if (!Array.isArray(actionKeys) || actionKeys.length < 2) return undefined;
  const allowed = new Set(actionKeys);
  const candidates = row.candidates
    .filter((candidate) => allowed.has(candidate.actionKey))
    .sort(
      (left, right) =>
        Number(left.rank) - Number(right.rank) ||
        String(left.actionKey).localeCompare(String(right.actionKey)),
    )
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  if (
    candidates.length < 2 ||
    !candidates.some((candidate) => candidate.actionKey === row.observedActionKey)
  ) {
    return undefined;
  }
  return { ...row, candidates, observedActionInCandidateSet: true };
}

export function createBehavioralV7Metric() {
  return {
    decisionCount: 0,
    supportCount: 0,
    top1Count: 0,
    lossSum: 0,
    minimumObservedRawProbability: 1,
    floorLossSums: new Map(V7_PROPENSITY_FLOORS.map((floor) => [floor, 0])),
    groups: new Map(),
  };
}

export function observeBehavioralV7Metric(metric, row, prediction) {
  const probability = prediction.observedActionProbability;
  metric.decisionCount += 1;
  metric.supportCount += probability >= V7_SUPPORT_PROBABILITY ? 1 : 0;
  metric.top1Count += prediction.topActionKey === row.observedActionKey ? 1 : 0;
  metric.lossSum += -Math.log(Math.max(probability, 1e-15));
  metric.minimumObservedRawProbability = Math.min(
    metric.minimumObservedRawProbability,
    probability,
  );
  for (const floor of V7_PROPENSITY_FLOORS) {
    metric.floorLossSums.set(
      floor,
      (metric.floorLossSums.get(floor) ?? 0) +
        -Math.log(Math.max(probability, floor)),
    );
  }
  for (const key of behavioralV7GroupKeys(row)) {
    const group = metric.groups.get(key) ?? {
      decisionCount: 0,
      supportCount: 0,
      lossSum: 0,
      top1Count: 0,
    };
    group.decisionCount += 1;
    group.supportCount += probability >= V7_SUPPORT_PROBABILITY ? 1 : 0;
    group.lossSum += -Math.log(Math.max(probability, 1e-15));
    group.top1Count += prediction.topActionKey === row.observedActionKey ? 1 : 0;
    metric.groups.set(key, group);
  }
}

export function finalizeBehavioralV7Metric(metric) {
  const rawLogLoss = divide(metric.lossSum, metric.decisionCount);
  const floorSensitivity = V7_PROPENSITY_FLOORS.map((floor) => {
    const logLoss = divide(
      metric.floorLossSums.get(floor) ?? 0,
      metric.decisionCount,
    );
    return {
      floor,
      logLoss,
      logLossDeltaFromRaw: Math.abs(logLoss - rawLogLoss),
    };
  });
  const groups = [...metric.groups.entries()]
    .map(([key, group]) => ({
      key,
      decisionCount: group.decisionCount,
      major: group.decisionCount >= V7_MAJOR_GROUP_MIN_DECISIONS,
      supportCoverage: divide(group.supportCount, group.decisionCount),
      rawLogLoss: divide(group.lossSum, group.decisionCount),
      top1Rate: divide(group.top1Count, group.decisionCount),
    }))
    .sort((left, right) =>
      left.key.localeCompare(right.key, undefined, { numeric: true }),
    );
  const majorLowSupportGroups = groups.filter(
    (group) => group.major && group.supportCoverage < 0.75,
  );
  return {
    decisionCount: metric.decisionCount,
    supportCoverage: divide(metric.supportCount, metric.decisionCount),
    rawLogLoss,
    top1Rate: divide(metric.top1Count, metric.decisionCount),
    minimumObservedRawProbability: metric.minimumObservedRawProbability,
    floorSensitivity,
    floorSensitivityDelta: Math.max(
      ...floorSensitivity.map((value) => value.logLossDeltaFromRaw),
    ),
    groups,
    majorLowSupportGroups,
    majorLowSupportGroupCount: majorLowSupportGroups.length,
  };
}

export function behavioralV7GroupSupport(groups, key) {
  return groups.find((group) => group.key === key)?.supportCoverage ?? 0;
}

export function behavioralV7GroupKeys(row) {
  const time = Number(row.state.gameTimeS);
  return [
    `PHASE:${row.state.phase}`,
    `HERO:${row.state.heroId}`,
    `ECONOMY:${economyBand(Number(row.state.netWorth))}`,
    `TIME:${Math.floor(time / 300) * 5}-${Math.floor(time / 300) * 5 + 5}m`,
  ];
}

export function fnv1a32(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function behavioralV7ContinuationChecks(metric, candidateCoverage) {
  const lateSupportCoverage = behavioralV7GroupSupport(
    metric.groups,
    'PHASE:LATE',
  );
  const highEconomySupportCoverage = behavioralV7GroupSupport(
    metric.groups,
    'ECONOMY:GE_20000',
  );
  return {
    candidateCoverageAtLeast099: candidateCoverage >= 0.99,
    supportAtLeast086: metric.supportCoverage >= 0.86,
    supportGainAtLeast001: metric.supportCoverage >= 0.845920177383592,
    rawLogLossBeatsV6Sequence: metric.rawLogLoss < 2.747655053608051,
    floorSensitivityBelow028: metric.floorSensitivityDelta < 0.28,
    majorLowSupportGroupsAtMost2: metric.majorLowSupportGroupCount <= 2,
    lateSupportBeatsV6: lateSupportCoverage > 0.7670886075949367,
    highEconomySupportBeatsV6:
      highEconomySupportCoverage > 0.7611583421891605,
  };
}

export function behavioralV7ReleaseChecks(metric, candidateCoverage) {
  return {
    candidateCoverageAtLeast099: candidateCoverage >= 0.99,
    supportAtLeast090: metric.supportCoverage >= 0.9,
    noMajorLowSupportGroups: metric.majorLowSupportGroupCount === 0,
    floorSensitivityAtMost002: metric.floorSensitivityDelta <= 0.02,
    probabilitiesFinite:
      Number.isFinite(metric.rawLogLoss) &&
      Number.isFinite(metric.supportCoverage) &&
      Number.isFinite(metric.floorSensitivityDelta),
  };
}

function economyBand(value) {
  if (!Number.isFinite(value)) return 'UNKNOWN';
  if (value < 5000) return 'LT_5000';
  if (value < 10000) return '5000_9999';
  if (value < 15000) return '10000_14999';
  if (value < 20000) return '15000_19999';
  return 'GE_20000';
}

function divide(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}
