import type { Archetype, MechanismConfig } from '../types';
import { ARCHETYPES } from '../types';
import { quantity } from '../naming';
import { reseedForArchetype } from '../defaults';

interface Props {
  mech: MechanismConfig;
  open: boolean;
  duplicateIds: Set<number>;
  onToggle: () => void;
  onChange: (patch: Partial<MechanismConfig>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function Num({
  label,
  value,
  onChange,
  step = 'any',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
}) {
  return (
    <label className="f">
      {label}
      <input
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
    </label>
  );
}

export function MechanismCard({
  mech,
  open,
  duplicateIds,
  onToggle,
  onChange,
  onRemove,
  canRemove,
}: Props) {
  const meta = ARCHETYPES[mech.archetype];
  const positional = meta.positional;
  const q = quantity(mech);
  const unit = mech.archetype === 'arm' ? 'deg' : 'm';
  // Motion Magic is configured in mechanism rotations, but min/max above are in
  // degrees or metres. Show the conversion so the two are not read as one scale.
  const perRotation =
    mech.archetype === 'arm' ? 360 : 2 * Math.PI * mech.drumRadiusMeters;
  const round = (v: number) => Number(v.toFixed(v < 1 ? 3 : 1));
  const motionPerSecond = round(mech.cruiseVelocity * perRotation);
  const motionPerSecondSquared = round(mech.acceleration * perRotation);

  const setArchetype = (archetype: Archetype) => {
    onChange(reseedForArchetype(mech, archetype));
  };

  const setMotor = (index: number, patch: Partial<MechanismConfig['motors'][0]>) => {
    const motors = mech.motors.map((m, i) => (i === index ? { ...m, ...patch } : m));
    onChange({ motors });
  };

  return (
    <div className={`mech${open ? ' open' : ''}`}>
      <div
        className="mech-summary"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onToggle()}
      >
        <span className="name">{mech.name || 'unnamed'}</span>
        <span className="chip">
          {meta.label.toLowerCase()} · {mech.motors.length} motor
          {mech.motors.length === 1 ? '' : 's'} · {mech.reduction}:1
        </span>
        <span className="spacer" />
        <span className="chip">{open ? '−' : '+'}</span>
      </div>

      {open && (
        <div className="mech-body">
          <div className="archetypes">
            {(Object.keys(ARCHETYPES) as Archetype[]).map((a) => (
              <button
                key={a}
                aria-pressed={mech.archetype === a}
                onClick={() => setArchetype(a)}
              >
                {ARCHETYPES[a].label}
              </button>
            ))}
          </div>

          <div className="grid">
            <label className="f">
              Name (camelCase)
              <input
                value={mech.name}
                onChange={(e) => onChange({ name: e.target.value.replace(/\s/g, '') })}
              />
            </label>
            <label className="f">
              Control request
              <select
                value={mech.control}
                onChange={(e) =>
                  onChange({ control: e.target.value as MechanismConfig['control'] })
                }
              >
                {meta.controls.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="f">
              Motor
              <select
                value={mech.motorModel}
                onChange={(e) =>
                  onChange({ motorModel: e.target.value as MechanismConfig['motorModel'] })
                }
              >
                <option value="KrakenX60">Kraken X60</option>
                <option value="KrakenX44">Kraken X44</option>
              </select>
            </label>

            <div className="subhead">Motors</div>
            <div style={{ gridColumn: '1 / -1' }}>
              {mech.motors.map((motor, i) => (
                <div className="motor-row" key={i}>
                  <span className="tag">{i === 0 ? 'lead' : `follow ${i}`}</span>
                  <input
                    type="number"
                    className={duplicateIds.has(motor.canId) ? 'invalid' : ''}
                    value={motor.canId}
                    onChange={(e) => setMotor(i, { canId: Number(e.target.value) })}
                  />
                  {i === 0 ? (
                    <select
                      value={mech.invertLead}
                      onChange={(e) =>
                        onChange({ invertLead: e.target.value as MechanismConfig['invertLead'] })
                      }
                    >
                      <option value="CounterClockwise_Positive">CCW positive</option>
                      <option value="Clockwise_Positive">CW positive</option>
                    </select>
                  ) : (
                    <select
                      value={motor.alignment}
                      onChange={(e) =>
                        setMotor(i, {
                          alignment: e.target.value as MechanismConfig['motors'][0]['alignment'],
                        })
                      }
                    >
                      <option value="Aligned">Aligned</option>
                      <option value="Opposed">Opposed</option>
                    </select>
                  )}
                  {i > 0 ? (
                    <button
                      className="icon-btn"
                      title="Remove motor"
                      onClick={() =>
                        onChange({ motors: mech.motors.filter((_, j) => j !== i) })
                      }
                    >
                      ×
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
              <button
                onClick={() =>
                  onChange({ motors: [...mech.motors, { canId: 0, alignment: 'Opposed' }] })
                }
              >
                + motor
              </button>
            </div>

            <div className="subhead">Gearing</div>
            <Num
              label="Reduction (:1)"
              value={mech.reduction}
              onChange={(v) => onChange({ reduction: v })}
            />
            {(mech.archetype === 'roller' || mech.archetype === 'arm') && (
              <Num label="MOI (kg m²)" value={mech.moi} onChange={(v) => onChange({ moi: v })} />
            )}
            {mech.archetype === 'arm' && (
              <Num
                label="Arm length (m)"
                value={mech.armLengthMeters}
                onChange={(v) => onChange({ armLengthMeters: v })}
              />
            )}
            {mech.archetype === 'elevator' && (
              <>
                <Num
                  label="Drum radius (m)"
                  value={mech.drumRadiusMeters}
                  onChange={(v) => onChange({ drumRadiusMeters: v })}
                />
                <Num
                  label="Carriage mass (kg)"
                  value={mech.carriageMassKg}
                  onChange={(v) => onChange({ carriageMassKg: v })}
                />
              </>
            )}
            {positional && (
              <label className="check" style={{ gridColumn: '1 / -1' }}>
                <input
                  type="checkbox"
                  checked={mech.simulateGravity}
                  onChange={(e) => onChange({ simulateGravity: e.target.checked })}
                />
                Simulate gravity
              </label>
            )}

            {mech.control !== 'VoltageOut' && (
              <>
                <div className="subhead">Gains</div>
                <Num label="kP" value={mech.kP} onChange={(v) => onChange({ kP: v })} />
                <Num label="kD (0 to omit)" value={mech.kD} onChange={(v) => onChange({ kD: v })} />
                <Num label="kS" value={mech.kS} onChange={(v) => onChange({ kS: v })} />
                <Num label="kV" value={mech.kV} onChange={(v) => onChange({ kV: v })} />
                <Num label="kA (0 to omit)" value={mech.kA} onChange={(v) => onChange({ kA: v })} />
                {positional && mech.simulateGravity && (
                  <Num label="kG" value={mech.kG} onChange={(v) => onChange({ kG: v })} />
                )}
              </>
            )}

            {positional && (
              <>
                <div className="subhead">Travel limits</div>
                <Num
                  label={`Min (${unit})`}
                  value={mech.minPosition}
                  onChange={(v) => onChange({ minPosition: v })}
                />
                <Num
                  label={`Max (${unit})`}
                  value={mech.maxPosition}
                  onChange={(v) => onChange({ maxPosition: v })}
                />
                <label className="check" style={{ gridColumn: '1 / -1' }}>
                  <input
                    type="checkbox"
                    checked={mech.softLimits}
                    onChange={(e) => onChange({ softLimits: e.target.checked })}
                  />
                  Enforce min/max as Phoenix soft limits
                </label>
              </>
            )}

            {mech.control === 'MotionMagicVoltage' && (
              <>
                <div className="subhead">Motion Magic</div>
                <Num
                  label={`Cruise velocity (mech rot/s ≈ ${motionPerSecond} ${unit}/s)`}
                  value={mech.cruiseVelocity}
                  onChange={(v) => onChange({ cruiseVelocity: v })}
                />
                <Num
                  label={`Acceleration (mech rot/s² ≈ ${motionPerSecondSquared} ${unit}/s²)`}
                  value={mech.acceleration}
                  onChange={(v) => onChange({ acceleration: v })}
                />
              </>
            )}

            <div className="subhead">Current limits and brake mode</div>
            <Num
              label="Stator limit (A)"
              value={mech.statorCurrentLimit}
              onChange={(v) => onChange({ statorCurrentLimit: v })}
            />
            <Num
              label="Supply limit (A)"
              value={mech.supplyCurrentLimit}
              onChange={(v) => onChange({ supplyCurrentLimit: v })}
            />
            <label className="f">
              Neutral mode
              <select
                value={mech.neutralMode}
                onChange={(e) =>
                  onChange({ neutralMode: e.target.value as MechanismConfig['neutralMode'] })
                }
              >
                <option value="Coast">Coast</option>
                <option value="Brake">Brake</option>
              </select>
            </label>

            {!positional && (
              <>
                <div className="subhead">Bring-up test target</div>
                {q === 'velocity' ? (
                  <Num
                    label="Test velocity (RPM)"
                    value={mech.testVelocityRPM}
                    onChange={(v) => onChange({ testVelocityRPM: v })}
                  />
                ) : (
                  <Num
                    label="Test output (V)"
                    value={mech.testVolts}
                    onChange={(v) => onChange({ testVolts: v })}
                  />
                )}
              </>
            )}
          </div>

          {canRemove && (
            <div style={{ marginTop: 10 }}>
              <button onClick={onRemove}>Remove mechanism</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
