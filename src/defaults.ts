import type {
  Archetype,
  Component3dConfig,
  LigamentConfig,
  MechanismConfig,
  SubsystemConfig,
  VisualizerConfig,
} from './types';
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
  kD: 0,
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
  softLimits: true,
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
    kP: 0.1,
    kS: 0.1,
    kV: 0.1,
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
  // Layering over the defaults backfills fields added since a config was
  // saved. Absent keys fall through to the default; present ones win, so this
  // is a no-op for a current config.
  const filled: MechanismConfig = {
    ...base(),
    ...PER_ARCHETYPE[mech.archetype],
    ...mech,
  };
  return controls.includes(filled.control) ? filled : { ...filled, control: controls[0] };
}

export function newLigament(
  drivenBy: string,
  overrides: Partial<LigamentConfig> = {},
): LigamentConfig {
  return {
    id: newId(),
    drivenBy,
    parentId: '',
    lengthInches: 8,
    angleDegrees: 0,
    width: 6,
    color: '52, 235, 137',
    ...overrides,
  };
}

export function newComponent3d(
  drivenBy: string,
  overrides: Partial<Component3dConfig> = {},
): Component3dConfig {
  return {
    id: newId(),
    drivenBy,
    parentId: '',
    componentIndex: 0,
    offsetXInches: 0,
    offsetYInches: 0,
    offsetZInches: 0,
    axis: 'z',
    ...overrides,
  };
}

/** Shape of the pre-list visualizer config, for migration. */
interface LegacyVisualizer {
  ligamentLengthInches?: number;
  ligamentAngleDegrees?: number;
  ligamentWidth?: number;
  color?: string;
  drivenBy?: string;
  componentIndex?: number;
  poseXInches?: number;
  poseYInches?: number;
  poseZInches?: number;
}

/** Clears parent links that dangle or loop, in either list. */
function sanitizeParents<T extends { id: string; parentId: string }>(items: T[]): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return items.map((item) => {
    let parentId = item.parentId !== item.id && byId.has(item.parentId) ? item.parentId : '';
    const seen = new Set([item.id]);
    for (let cursor = parentId; cursor; cursor = byId.get(cursor)?.parentId ?? '') {
      if (seen.has(cursor)) {
        parentId = '';
        break;
      }
      seen.add(cursor);
    }
    return { ...item, parentId };
  });
}

function normalizeVisualizer(
  viz: VisualizerConfig,
  mechanismNames: Set<string>,
): VisualizerConfig {
  const legacy = viz as VisualizerConfig & LegacyVisualizer;
  const legacyDriven =
    legacy.drivenBy && mechanismNames.has(legacy.drivenBy) ? legacy.drivenBy : '';

  let ligaments = Array.isArray(viz.ligaments) ? viz.ligaments : [];
  // Configs saved before ligaments were a list carried one flat set of fields.
  if (!ligaments.length && legacy.ligamentLengthInches !== undefined) {
    ligaments = [
      newLigament(legacyDriven, {
        lengthInches: legacy.ligamentLengthInches,
        angleDegrees: legacy.ligamentAngleDegrees ?? 0,
        width: legacy.ligamentWidth ?? 6,
        color: legacy.color ?? '52, 235, 137',
      }),
    ];
  }

  let components = Array.isArray(viz.components) ? viz.components : [];
  if (!components.length && legacy.componentIndex !== undefined) {
    components = [
      newComponent3d(legacyDriven, {
        componentIndex: legacy.componentIndex,
        offsetXInches: legacy.poseXInches ?? 0,
        offsetYInches: legacy.poseYInches ?? 0,
        offsetZInches: legacy.poseZInches ?? 0,
      }),
    ];
  }

  const clearMissing = <T extends { drivenBy: string }>(item: T): T =>
    mechanismNames.has(item.drivenBy) ? item : { ...item, drivenBy: '' };

  return {
    ...viz,
    ligaments: sanitizeParents(ligaments).map(clearMissing),
    components: sanitizeParents(components).map(clearMissing),
  };
}

/** Repairs anything that can drift out of sync across the whole config. */
export function normalizeConfig(config: SubsystemConfig): SubsystemConfig {
  const mechanisms = config.mechanisms.map(normalizeMechanism);
  const names = new Set(mechanisms.map((m) => m.name));
  return {
    ...config,
    mechanisms,
    visualizer: normalizeVisualizer(config.visualizer, names),
  };
}

/**
 * Re-seeds the physical and tuning fields when the archetype changes. Keeping
 * the old values carries a roller's MOI, Coast neutral mode and kV onto an arm,
 * where they are not just wrong but silently wrong. Identity — name, motors,
 * CAN ids, motor model — is preserved.
 */
export function reseedForArchetype(
  mech: MechanismConfig,
  archetype: Archetype,
): MechanismConfig {
  if (mech.archetype === archetype) return mech;
  const fresh = newMechanism(archetype, mech.name);
  return {
    ...fresh,
    id: mech.id,
    name: mech.name,
    motors: mech.motors,
    motorModel: mech.motorModel,
  };
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
      ligaments: [newLigament('roller')],
      rootXInches: 0,
      rootYInches: 10,
      components: [newComponent3d('roller')],
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
      ligaments: [newLigament('extension', { angleDegrees: 10.854 })],
      rootXInches: 11.5,
      rootYInches: 9.5,
      components: [
        newComponent3d('extension', { componentIndex: 0, offsetXInches: -10.239, axis: 'x' }),
      ],
    },
  };
}
