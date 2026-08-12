import type { Archetype, MechanismConfig, SubsystemConfig } from './types';
import { ARCHETYPES } from './types';

/**
 * Ids must not come from a module-level counter: the counter resets on every
 * page load while ids saved in localStorage persist, so a fresh mechanism
 * would collide with a stored one and edits would hit both.
 */
export const newId = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `m-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

const base = (): Omit<MechanismConfig, 'id' | 'name' | 'archetype' | 'control'> => ({
  motorModel: 'KrakenX60',
  motors: [{ canId: 0, alignment: 'Aligned' }],
  reduction: 1,
  moi: 0.001,
  kP: 0.2,
  kS: 0.25,
  kV: 0.12,
  kA: 0,
  kG: 0,
  statorCurrentLimit: 80,
  supplyCurrentLimit: 40,
  neutralMode: 'Coast',
  invertLead: 'CounterClockwise_Positive',
  minPosition: 0,
  maxPosition: 0.5,
  cruiseVelocity: 10,
  acceleration: 200,
  armLengthMeters: 0.3,
  simulateGravity: true,
  drumRadiusMeters: 0.019,
  carriageMassKg: 2,
  testVelocityRPM: 1000,
  testVolts: 4,
});

const PER_ARCHETYPE: Record<Archetype, Partial<MechanismConfig>> = {
  roller: {
    reduction: 3.45,
    moi: 0.001,
    kP: 0.2,
    kS: 0.25,
    kV: 0.396,
    neutralMode: 'Coast',
  },
  arm: {
    reduction: 50,
    moi: 0.05,
    kP: 10,
    kS: 0,
    kV: 0,
    kG: 0.3,
    neutralMode: 'Brake',
    minPosition: 0,
    maxPosition: 90,
    armLengthMeters: 0.3,
    simulateGravity: true,
    cruiseVelocity: 1,
    acceleration: 4,
  },
  elevator: {
    reduction: 3.33,
    kP: 20,
    kS: 0,
    kV: 0.07,
    neutralMode: 'Brake',
    minPosition: 0,
    maxPosition: 0.5,
    drumRadiusMeters: 0.019,
    carriageMassKg: 2,
    cruiseVelocity: 10,
    acceleration: 200,
  },
};

export function newMechanism(archetype: Archetype, name: string): MechanismConfig {
  return {
    ...base(),
    ...PER_ARCHETYPE[archetype],
    id: newId(),
    name,
    archetype,
    control: ARCHETYPES[archetype].controls[0],
  };
}

/**
 * Forces the control request to be legal for the archetype. A mismatch is
 * invisible in the UI — a select whose value is not among its options renders
 * as the first option — and generates code for the wrong quantity.
 */
export function normalizeMechanism(mech: MechanismConfig): MechanismConfig {
  const controls = ARCHETYPES[mech.archetype].controls;
  return controls.includes(mech.control) ? mech : { ...mech, control: controls[0] };
}

/** Repairs anything that can drift out of sync across the whole config. */
export function normalizeConfig(config: SubsystemConfig): SubsystemConfig {
  const mechanisms = config.mechanisms.map(normalizeMechanism);
  const names = new Set(mechanisms.map((m) => m.name));
  const visualizer = names.has(config.visualizer.drivenBy)
    ? config.visualizer
    : { ...config.visualizer, drivenBy: mechanisms[0]?.name ?? '' };
  return { ...config, mechanisms, visualizer };
}

export function newSubsystem(): SubsystemConfig {
  return {
    name: 'Example',
    packageRoot: 'frc.robot.subsystems',
    canBus: 'UpperBus',
    omitPrefixWhenSingle: true,
    mechanisms: [newMechanism('roller', 'roller')],
    visualizer: {
      enabled: false,
      mechanism2d: true,
      advantageScope3d: false,
      drivenBy: 'roller',
      ligamentLengthInches: 8,
      ligamentAngleDegrees: 0,
      ligamentWidth: 6,
      color: '52, 235, 137',
      rootXInches: 0,
      rootYInches: 10,
      componentIndex: 0,
      poseXInches: 0,
      poseYInches: 0,
      poseZInches: 0,
    },
  };
}

/** Populates the form with the real Intake, as a worked example. */
export function nomadIntakeExample(): SubsystemConfig {
  const roller = newMechanism('roller', 'roller');
  Object.assign(roller, {
    motors: [
      { canId: 30, alignment: 'Aligned' },
      { canId: 31, alignment: 'Opposed' },
    ],
    reduction: 3.45,
    kP: 0.2,
    kS: 0.25,
    kV: 0.396,
  });

  const kicker = newMechanism('roller', 'kicker');
  Object.assign(kicker, {
    motors: [{ canId: 34, alignment: 'Aligned' }],
    reduction: 1.5,
    kP: 0.2,
    kS: 0.25,
    kV: 0.164,
    invertLead: 'Clockwise_Positive',
  });

  const extension = newMechanism('elevator', 'extension');
  Object.assign(extension, {
    motors: [
      { canId: 32, alignment: 'Aligned' },
      { canId: 33, alignment: 'Opposed' },
    ],
    reduction: 3.33,
    kP: 20,
    kV: 0.07,
    maxPosition: 0.5,
    drumRadiusMeters: 0.019,
    carriageMassKg: 2,
    simulateGravity: false,
    invertLead: 'Clockwise_Positive',
  });

  return {
    name: 'Intake',
    packageRoot: 'frc.robot.subsystems',
    canBus: 'UpperBus',
    omitPrefixWhenSingle: true,
    mechanisms: [roller, kicker, extension],
    visualizer: {
      enabled: true,
      mechanism2d: true,
      advantageScope3d: false,
      drivenBy: 'extension',
      ligamentLengthInches: 8,
      ligamentAngleDegrees: 10.854,
      ligamentWidth: 6,
      color: '52, 235, 137',
      rootXInches: 11.5,
      rootYInches: 9.5,
      componentIndex: 0,
      poseXInches: -10.239,
      poseYInches: 0,
      poseZInches: 0,
    },
  };
}
