import * as fs from "fs";
import * as path from "path";

type ControlTagMapping = {
  tagID?: string;
  source?: string;
  inputs?: Record<string, string>;
};

type ControlTemplateMap = {
  templateFile: string;
  inputs?: Record<string, ControlTagMapping>;
  candidateInputs?: Record<string, ControlTagMapping>;
  outputs?: Record<string, ControlTagMapping>;
  sameMappingAs?: string;
};

type ControlLogicTagMap = {
  signals: {
    inputs: string[];
    outputs: string[];
  };
  templates: Record<string, ControlTemplateMap>;
};

const templatesDir = path.resolve(__dirname, "..", "templates");

function loadJson<T>(fileName: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(templatesDir, fileName), "utf8")
  ) as T;
}

function tagIdsForTemplate(templateFile: string): Set<string> {
  const doc = loadJson<{
    telemetry?: Array<{ id?: string }>;
    commands?: Array<{ id?: string }>;
    inputs?: Record<string, { tag?: string }>;
  }>(templateFile);

  const ids = new Set<string>();
  for (const entry of doc.telemetry || []) {
    if (entry.id) ids.add(entry.id);
  }
  for (const entry of doc.commands || []) {
    if (entry.id) ids.add(entry.id);
  }
  for (const entry of Object.values(doc.inputs || {})) {
    if (entry.tag) ids.add(entry.tag);
  }
  return ids;
}

function collectTagIds(mapping: ControlTemplateMap): string[] {
  const ids: string[] = [];
  const sections = [mapping.inputs, mapping.candidateInputs, mapping.outputs];
  for (const section of sections) {
    for (const item of Object.values(section || {})) {
      if (item.tagID) ids.push(item.tagID);
      for (const inputTag of Object.values(item.inputs || {})) {
        ids.push(inputTag);
      }
    }
  }
  return ids;
}

describe("control logic template tag map", () => {
  const map = loadJson<ControlLogicTagMap>("control_logic_tag_map.json");

  test("references existing template files and tag IDs", () => {
    for (const [profileName, mapping] of Object.entries(map.templates)) {
      const templateFile = path.join(templatesDir, mapping.templateFile);
      expect(fs.existsSync(templateFile)).toBe(true);

      if (mapping.sameMappingAs) {
        expect(map.templates[mapping.sameMappingAs]).toBeDefined();
      }

      const knownTagIds = tagIdsForTemplate(mapping.templateFile);
      for (const tagID of collectTagIds(mapping)) {
        expect({
          profileName,
          templateFile: mapping.templateFile,
          tagID,
          found: knownTagIds.has(tagID),
        }).toEqual(expect.objectContaining({ found: true }));
      }
    }
  });

  test("uses known canonical control input/output signal names", () => {
    const knownSignals = new Set([
      ...map.signals.inputs,
      ...map.signals.outputs,
      "IslandingSequencerCommand.pcsOnOff",
      "MiniPvDcControl.enable",
      "MiniPvDcControl.start",
      "MiniPvDcControl.stop",
      "MiniPvDcControl.clearFault",
      "MiniPvDcControl.busCurrentLimitA",
      "AmpaceBmsControl.hvContactorMode",
      "AmpaceBmsControl.hvContactorControl",
    ]);

    for (const mapping of Object.values(map.templates)) {
      for (const signalName of [
        ...Object.keys(mapping.inputs || {}),
        ...Object.keys(mapping.candidateInputs || {}),
        ...Object.keys(mapping.outputs || {}),
      ]) {
        expect({
          signalName,
          found: knownSignals.has(signalName),
        }).toEqual(expect.objectContaining({ found: true }));
      }
    }
  });
});
