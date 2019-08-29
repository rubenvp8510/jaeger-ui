// Copyright (c) 2019 Uber Technologies, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const hasFocal = (path, focalService, focalOperation) => {
  for (let i = 0; i < path.length; ++i) {
    if (focalService === path[i].service && (focalOperation == null || focalOperation === path[i].operation)) {
      return true;
    }
  }
  return false;
};

function convertSpan(span, trace) {
  const serviceName = trace.processes[span.processID].serviceName;
  const operationName = span.operationName;
  return { service: serviceName, operation: operationName };
}

function findPathToRoot(node, root, nodes, trace, focalService, focalOperation) {
  const path = [];
  let actual = node;
  while (actual !== root && actual.value.references !== undefined && Array.isArray(actual.value.references) && actual.value.references.length) {
    path.push(convertSpan(actual.value, trace));
    actual = nodes.get(actual.value.references[0].spanID);
  }
  path.push(convertSpan(actual.value, trace));
  if (hasFocal(path, focalService, focalOperation) === true) {
    return { path: path.reverse(), trace: trace.id};
  }
  return null;
}

const processTrace = (trace, focalService, focalOperation) => {
  const root = { children: [] };
  const nodes = new Map(trace.spans.map(span => [span.spanID,  { children: [], value: span }]));
  nodes.forEach(node => {
    const span = node.value;
    if (Array.isArray(span.references) && span.references.length) {
      const reference = span.references[0];
      const parent = nodes.get(reference.spanID);
      if(parent) {
        parent.children.push(node);
      }
    } else {
      root.children.push(node);
    }
  });
  // Process leaves
  const paths = [];
  nodes.forEach(node => {
    if (node.children.length === 0) {
      const path = findPathToRoot(node, root, nodes, trace, focalService, focalOperation);
      if (path) {
        paths.push(path);
      }
    }
  });
  return paths;
};

export default function(traces, focalService, focalOperation) {
  let paths = [];
  Object.values(traces).forEach( trace  => {
    paths = paths.concat(processTrace(trace.data, focalService, focalOperation));
  });
  return paths;
};