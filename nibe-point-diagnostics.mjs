const candidatePattern = /kompressor|compressor|frekvens|frequency|varvtal|hastighet|motor speed|motor rpm/i;

/**
 * Return only likely compressor-frequency points from the provider's full point
 * catalogue. This is diagnostic discovery only; it does not change collection.
 */
export function findNibePointCandidates(payload) {
  const devices = Array.isArray(payload?.devices) ? payload.devices : [];
  let totalPoints = 0;
  const candidates = [];
  for (const device of devices) {
    const points = Array.isArray(device?.points) ? device.points : [];
    totalPoints += points.length;
    for (const point of points) {
      const parameterName = String(point?.parameterName ?? point?.name ?? '');
      if (!candidatePattern.test(parameterName)) continue;
      const rawValue = point?.value ?? point?.parameterValue ?? point?.currentValue ?? null;
      const value = typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : null;
      candidates.push({
        deviceName: String(device?.deviceName ?? device?.name ?? device?.productName ?? 'NIBE device'),
        parameterId: String(point?.parameterId ?? point?.id ?? ''),
        parameterName,
        value,
        unit: String(point?.parameterUnit ?? point?.unit ?? ''),
        sourceTimestamp: point?.timestamp ?? point?.updatedAt ?? point?.lastUpdated ?? point?.time ?? null,
      });
    }
  }
  return {
    readOnly: true,
    totalDevices: devices.length,
    totalPoints,
    candidateCount: candidates.length,
    candidates,
    note: 'Candidates are not automatically recorded. Verify the exact meaning and unit before enabling a point.',
  };
}
