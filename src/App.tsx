import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import type { Archetype, MechanismConfig, SubsystemConfig } from './types';
import { ARCHETYPES } from './types';
import {
  newId,
  newMechanism,
  newSubsystem,
  nomadIntakeExample,
  normalizeConfig,
  normalizeMechanism,
} from './defaults';
import { generateAll, generateVisualizerSnippets } from './generate';
import { MechanismCard } from './components/MechanismCard';

const STORAGE_KEY = 'nomad-subsystem-generator-config';

/**
 * Reassigns every mechanism id. Configs written by earlier versions can hold
 * colliding ids, which made edits apply to more than one mechanism.
 */
function withFreshIds(config: SubsystemConfig): SubsystemConfig {
  return normalizeConfig({
    ...config,
    mechanisms: config.mechanisms.map((m) => ({ ...m, id: newId() })),
  });
}

function loadConfig(): SubsystemConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return withFreshIds(JSON.parse(raw) as SubsystemConfig);
  } catch {
    // Corrupt or unavailable storage just falls back to a fresh config.
  }
  return newSubsystem();
}

/** Problems worth blocking on — everything here would produce broken Java. */
function validate(config: SubsystemConfig): string[] {
  const problems: string[] = [];

  if (!/^[A-Z][A-Za-z0-9]*$/.test(config.name)) {
    problems.push('Subsystem name must be PascalCase with no spaces.');
  }

  const ids = config.mechanisms.flatMap((m) => m.motors.map((mo) => mo.canId));
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length) {
    problems.push(`Duplicate CAN id${dupes.length > 1 ? 's' : ''}: ${dupes.join(', ')}.`);
  }

  const names = config.mechanisms.map((m) => m.name);
  const dupeNames = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  if (dupeNames.length) {
    problems.push(`Duplicate mechanism names: ${dupeNames.join(', ')}.`);
  }
  if (names.some((n) => !/^[a-z][A-Za-z0-9]*$/.test(n))) {
    problems.push('Mechanism names must be camelCase with no spaces.');
  }

  for (const m of config.mechanisms) {
    if (ARCHETYPES[m.archetype].positional && m.minPosition >= m.maxPosition) {
      problems.push(`${m.name}: min must be less than max.`);
    }
    if (m.reduction <= 0) problems.push(`${m.name}: reduction must be greater than 0.`);
  }

  return problems;
}

export default function App() {
  const [config, setConfig] = useState<SubsystemConfig>(loadConfig);
  const [openId, setOpenId] = useState<string | null>(config.mechanisms[0]?.id ?? null);
  const [tab, setTab] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const files = useMemo(() => generateAll(config), [config]);
  const snippets = useMemo(() => generateVisualizerSnippets(config), [config]);
  const problems = useMemo(() => validate(config), [config]);

  const duplicateIds = useMemo(() => {
    const ids = config.mechanisms.flatMap((m) => m.motors.map((mo) => mo.canId));
    return new Set(ids.filter((id, i) => ids.indexOf(id) !== i));
  }, [config]);

  const patch = (p: Partial<SubsystemConfig>) => setConfig((c) => ({ ...c, ...p }));

  const patchMechanism = (id: string, p: Partial<MechanismConfig>) =>
    setConfig((c) => {
      const prev = c.mechanisms.find((m) => m.id === id);
      const mechanisms = c.mechanisms.map((m) =>
        m.id === id ? normalizeMechanism({ ...m, ...p }) : m,
      );
      // Follow a rename so the visualizer keeps pointing at the same mechanism.
      const visualizer =
        prev && p.name !== undefined && c.visualizer.drivenBy === prev.name
          ? { ...c.visualizer, drivenBy: p.name }
          : c.visualizer;
      return { ...c, mechanisms, visualizer };
    });

  const addMechanism = (archetype: Archetype) => {
    const mech = newMechanism(archetype, archetype);
    // The name has to be uniquified inside the updater; reading `config` from
    // the closure goes stale when several are added before the next render.
    setConfig((c) => {
      const existing = new Set(c.mechanisms.map((m) => m.name));
      let name: string = archetype;
      let n = 2;
      while (existing.has(name)) name = `${archetype}${n++}`;
      return { ...c, mechanisms: [...c.mechanisms, { ...mech, name }] };
    });
    setOpenId(mech.id);
  };

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1200);
  };

  const downloadZip = async () => {
    const zip = new JSZip();
    const dir = `${config.packageRoot.replace(/\./g, '/')}/${config.name.toLowerCase()}`;
    for (const f of files) zip.file(`${dir}/${f.name}`, f.contents);
    if (snippets.length) {
      zip.file(
        `${dir}/RobotVisualizer-snippets.txt`,
        snippets
          .map((s) => `// ${s.label} — paste into ${s.target}\n\n${s.code}\n`)
          .join('\n\n'),
      );
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.name}-subsystem.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.name}-config.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File) => {
    file.text().then((text) => {
      try {
        const parsed = withFreshIds(JSON.parse(text) as SubsystemConfig);
        setConfig(parsed);
        setOpenId(parsed.mechanisms[0]?.id ?? null);
      } catch {
        alert('That file is not a valid config JSON.');
      }
    });
  };

  const viz = config.visualizer;
  const tabs = [...files.map((f) => f.name), ...(snippets.length ? ['Visualizer'] : [])];
  const activeTab = Math.min(tab, tabs.length - 1);

  return (
    <div className="app">
      <div className="topbar">
        <h1>FRC subsystem generator</h1>
        <span className="sub">TalonFX · Phoenix 6 · NOMAD</span>
        <span className="spacer" />
        <button
          onClick={() => {
            const example = nomadIntakeExample();
            setConfig(example);
            setOpenId(example.mechanisms[0].id);
          }}
        >
          Load intake example
        </button>
        <button onClick={() => fileInput.current?.click()}>Import</button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])}
        />
        <button onClick={exportJson}>Export</button>
        <button
          onClick={() => {
            const fresh = newSubsystem();
            setConfig(fresh);
            setOpenId(fresh.mechanisms[0].id);
          }}
        >
          Reset
        </button>
      </div>

      <div className="panes">
        <div className="config">
          <section className="card">
            <header>
              <span className="step">1</span>
              <h2>Subsystem</h2>
            </header>
            <div className="grid">
              <label className="f">
                Name (PascalCase)
                <input value={config.name} onChange={(e) => patch({ name: e.target.value })} />
              </label>
              <label className="f">
                Package root
                <input
                  value={config.packageRoot}
                  onChange={(e) => patch({ packageRoot: e.target.value })}
                />
              </label>
              <label className="f">
                CAN bus
                <select
                  value={config.canBus}
                  onChange={(e) => patch({ canBus: e.target.value as SubsystemConfig['canBus'] })}
                >
                  <option value="UpperBus">UpperBus</option>
                  <option value="LowerBus">LowerBus</option>
                </select>
              </label>
              <label className="check" style={{ gridColumn: '1 / -1' }}>
                <input
                  type="checkbox"
                  checked={config.omitPrefixWhenSingle}
                  onChange={(e) => patch({ omitPrefixWhenSingle: e.target.checked })}
                />
                Drop the name prefix when there is only one mechanism
              </label>
            </div>
          </section>

          <section className="card">
            <header>
              <span className="step">2</span>
              <h2>Mechanisms</h2>
              <span className="spacer" />
              <span className="step">{config.mechanisms.length}</span>
            </header>
            {config.mechanisms.map((m) => (
              <MechanismCard
                key={m.id}
                mech={m}
                open={openId === m.id}
                duplicateIds={duplicateIds}
                onToggle={() => setOpenId(openId === m.id ? null : m.id)}
                onChange={(p) => patchMechanism(m.id, p)}
                onRemove={() =>
                  setConfig((c) => ({
                    ...c,
                    mechanisms: c.mechanisms.filter((x) => x.id !== m.id),
                  }))
                }
                canRemove={config.mechanisms.length > 1}
              />
            ))}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {(Object.keys(ARCHETYPES) as Archetype[]).map((a) => (
                <button key={a} onClick={() => addMechanism(a)}>
                  + {ARCHETYPES[a].label.toLowerCase()}
                </button>
              ))}
            </div>
          </section>

          <section className="card">
            <header>
              <span className="step">3</span>
              <h2>States</h2>
            </header>
            <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 12.5 }}>
              A fixed <code>IDLE / TEST_FORWARD / TEST_REVERSE</code> enum is automatically generated so you
              can verify the mechanism moves. Replace it with the real states after you verify it works in sim.
            </p>
          </section>

          <section className="card">
            <header>
              <span className="step">4</span>
              <h2>Visualizer</h2>
              <span className="spacer" />
              <label className="check">
                <input
                  type="checkbox"
                  checked={viz.enabled}
                  onChange={(e) => patch({ visualizer: { ...viz, enabled: e.target.checked } })}
                />
                enabled
              </label>
            </header>
            {viz.enabled && (
              <div className="grid">
                <label className="check" style={{ gridColumn: '1 / -1' }}>
                  <input
                    type="checkbox"
                    checked={viz.mechanism2d}
                    onChange={(e) =>
                      patch({ visualizer: { ...viz, mechanism2d: e.target.checked } })
                    }
                  />
                  Mechanism2d
                </label>
                <label className="check" style={{ gridColumn: '1 / -1' }}>
                  <input
                    type="checkbox"
                    checked={viz.advantageScope3d}
                    onChange={(e) =>
                      patch({ visualizer: { ...viz, advantageScope3d: e.target.checked } })
                    }
                  />
                  AdvantageScope 3D poses
                </label>
                <label className="f">
                  Driven by
                  <select
                    value={viz.drivenBy}
                    onChange={(e) => patch({ visualizer: { ...viz, drivenBy: e.target.value } })}
                  >
                    {config.mechanisms.map((m) => (
                      <option key={m.id} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                {viz.mechanism2d && (
                  <>
                    <div className="subhead">Mechanism2d</div>
                    <label className="f">
                      Ligament length (in)
                      <input
                        type="number"
                        value={viz.ligamentLengthInches}
                        onChange={(e) =>
                          patch({
                            visualizer: { ...viz, ligamentLengthInches: Number(e.target.value) },
                          })
                        }
                      />
                    </label>
                    <label className="f">
                      Ligament angle (deg)
                      <input
                        type="number"
                        value={viz.ligamentAngleDegrees}
                        onChange={(e) =>
                          patch({
                            visualizer: { ...viz, ligamentAngleDegrees: Number(e.target.value) },
                          })
                        }
                      />
                    </label>
                    <label className="f">
                      Colour (r, g, b)
                      <input
                        value={viz.color}
                        onChange={(e) => patch({ visualizer: { ...viz, color: e.target.value } })}
                      />
                    </label>
                    <label className="f">
                      Root X offset (in)
                      <input
                        type="number"
                        value={viz.rootXInches}
                        onChange={(e) =>
                          patch({ visualizer: { ...viz, rootXInches: Number(e.target.value) } })
                        }
                      />
                    </label>
                    <label className="f">
                      Root Y (in)
                      <input
                        type="number"
                        value={viz.rootYInches}
                        onChange={(e) =>
                          patch({ visualizer: { ...viz, rootYInches: Number(e.target.value) } })
                        }
                      />
                    </label>
                  </>
                )}
                {viz.advantageScope3d && (
                  <>
                    <div className="subhead">3D pose (matches model_N.glb)</div>
                    <label className="f">
                      Component index
                      <input
                        type="number"
                        value={viz.componentIndex}
                        onChange={(e) =>
                          patch({
                            visualizer: { ...viz, componentIndex: Number(e.target.value) },
                          })
                        }
                      />
                    </label>
                    <label className="f">
                      Pose X (in)
                      <input
                        type="number"
                        value={viz.poseXInches}
                        onChange={(e) =>
                          patch({ visualizer: { ...viz, poseXInches: Number(e.target.value) } })
                        }
                      />
                    </label>
                    <label className="f">
                      Pose Y (in)
                      <input
                        type="number"
                        value={viz.poseYInches}
                        onChange={(e) =>
                          patch({ visualizer: { ...viz, poseYInches: Number(e.target.value) } })
                        }
                      />
                    </label>
                    <label className="f">
                      Pose Z (in)
                      <input
                        type="number"
                        value={viz.poseZInches}
                        onChange={(e) =>
                          patch({ visualizer: { ...viz, poseZInches: Number(e.target.value) } })
                        }
                      />
                    </label>
                  </>
                )}
              </div>
            )}
          </section>
        </div>

        <div className="preview-pane">
          {problems.length > 0 && (
            <div className="problems">
              <strong>Fix before using this output</strong>
              <ul>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="tabs">
            {tabs.map((name, i) => (
              <button key={name} aria-selected={activeTab === i} onClick={() => setTab(i)}>
                {name}
              </button>
            ))}
          </div>

          {activeTab < files.length ? (
            <pre className="code">{files[activeTab].contents}</pre>
          ) : (
            <div className="code">
              {snippets.map((s) => (
                <div className="snippet" key={s.label}>
                  <div className="target">
                    // {s.label} — paste into {s.target}
                  </div>
                  <pre style={{ margin: 0 }}>{s.code}</pre>
                  <button
                    style={{ marginTop: 6 }}
                    onClick={() => copy(s.code, s.label)}
                  >
                    {copied === s.label ? 'Copied' : 'Copy'}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="preview-actions">
            {activeTab < files.length && (
              <button
                onClick={() => copy(files[activeTab].contents, files[activeTab].name)}
              >
                {copied === files[activeTab].name ? 'Copied' : 'Copy file'}
              </button>
            )}
            <button className="primary" onClick={downloadZip}>
              Download .zip
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
