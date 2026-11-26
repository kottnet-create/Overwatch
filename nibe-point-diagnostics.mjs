const namePatterns = [
  ['compressor', /kompressor|compressor/i],
  ['frequency', /frekvens|frequency|hz/i],
  ['speed', /varvtal|hastighet|speed|rpm|r\/min/i],
  ['motor', /motor/i],
  ['pump', /pump|pumpvarv|pumphastighet/i],
];
const frequencyUnitPattern = /^(?:hz|khz|mhz|rpm|r\/min|1\/min|min\^-1|s\^-1)$/i;
const normalizeUnit = value => String(value ?? '').trim().replace(/\s+/g, '').replace(/perminute/i, '/min');

export function findNibePointCandidates(payload) {
  const devices = Array.isArray(payload?.devices) ? payload.devices : [];
  let totalPoints = 0;
  const candidates = [];
  const unitCounts = {};
  for (const device of devices) {
    const points = Array.isArray(device?.points) ? device.points : [];
    totalPoints += points.length;
    for (const point of points) {
      const parameterName = String(point?.parameterName ?? point?.name ?? '');
      const unit = String(point?.parameterUnit ?? point?.unit ?? '');
      const normalizedUnit = normalizeUnit(unit);
      const matchedBy = namePatterns.filter(([, pattern]) => pattern.test(parameterName)).map(([key]) => key);
      const frequencyUnit = frequencyUnitPattern.test(normalizedUnit);
      unitCounts[unit || '(no unit)'] = (unitCounts[unit || '(no unit)'] || 0) + 1;
      if (!matchedBy.length && !frequencyUnit) continue;
      const rawValue = point?.value ?? point?.parameterValue ?? point?.currentValue ?? null;
      const value = typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : null;
      candidates.push({
        deviceName: String(device?.deviceName ?? device?.name ?? device?.productName ?? 'NIBE device'),
        parameterId: String(point?.parameterId ?? point?.id ?? ''),
        parameterName,
        value,
        unit,
        frequencyUnit,
        matchedBy,
        sourceTimestamp: point?.timestamp ?? point?.updatedAt ?? point?.lastUpdated ?? point?.time ?? null,
      });
    }
  }
  candidates.sort((a, b) => Number(b.frequencyUnit) - Number(a.frequencyUnit) || a.parameterName.localeCompare(b.parameterName, 'sv'));
  return {
    readOnly: true,
    totalDevices: devices.length,
    totalPoints,
    candidateCount: candidates.length,
    frequencyUnitCount: candidates.filter(point => point.frequencyUnit).length,
    unitCounts,
    candidates,
    note: 'Candidates are diagnostic only. Names and units are clues, not proof of meaning. Verify provider metadata before enabling collection.',
  };
}
