// Health values stay in memory; callers must check the permission and date.
export function stepsProgress(summary, goal, today) {
  const steps = summary?.stepsGranted && summary.stepsDate === today && Number.isSafeInteger(summary.steps) && summary.steps >= 0
    ? summary.steps : null;
  const target = Number.isInteger(goal) && goal >= 100 && goal <= 100000 ? goal : 8000;
  return { steps, goal: target, percent: steps === null ? 0 : Math.min(100, Math.round(steps / target * 100)) };
}

export function latestHealthWeight(summary, today) {
  if (!summary?.weightGranted || !Number.isFinite(summary.weight) || summary.weight < 20 || summary.weight > 500 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(summary.weightDate || '') || summary.weightDate > today) return null;
  return { weight: summary.weight, date: summary.weightDate };
}
export function healthBurnedCalories(summary, today) {
  if (!summary?.energyGranted || summary.energyDate !== today || typeof summary.burnedCalories !== 'number' || !Number.isFinite(summary.burnedCalories) || summary.burnedCalories < 0) return null;
  return Math.round(summary.burnedCalories);
}
