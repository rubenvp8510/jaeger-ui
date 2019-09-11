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

import React, { Component } from 'react';
import { History as RouterHistory, Location } from 'history';
import _get from 'lodash/get';
import { bindActionCreators, Dispatch } from 'redux';
import { connect } from 'react-redux';

import { getUrl, getUrlState } from './url';
import Header from './Header';
import Graph from './Graph';
import ErrorMessage from '../common/ErrorMessage';
import LoadingIndicator from '../common/LoadingIndicator';
import { extractUiFindFromState, TExtractUiFindFromStateReturn } from '../common/UiFindInput';
import * as jaegerApiActions from '../../actions/jaeger-api';
import { fetchedState } from '../../constants';
import {
  stateKey,
  EDirection,
  TDdgModelParams,
  TDdgSparseUrlState,
  TDdgStateEntry,
} from '../../model/ddg/types';
import TGraph, { makeGraph } from '../../model/ddg/Graph';
import { encodeDistance } from '../../model/ddg/visibility-codec';
import { ReduxState } from '../../types';

import './index.css';

type TDispatchProps = {
  fetchDeepDependencyGraph: (query: TDdgModelParams) => void;
  fetchServices: () => void;
  fetchServiceOperations: (service: string) => void;
  transformTracesToDDG: (trace: any) => void;
};

type TReduxProps = TExtractUiFindFromStateReturn & {
  graph: TGraph | undefined;
  graphState?: TDdgStateEntry;
  operationsForService: Record<string, string[]>;
  services?: string[] | null;
  urlState: TDdgSparseUrlState;
  trace: any,
};

type TOwnProps = {
  history: RouterHistory;
  location: Location;
};

type TProps = TDispatchProps & TReduxProps & TOwnProps;

// export for tests
export class DeepDependencyGraphPageImpl extends Component<TProps> {
  static fetchModelIfStale(props: TProps) {
    const { transformTracesToDDG, graphState = null, urlState } = props;
    const { service, operation } = urlState;
    // backend temporarily requires service and operation
    if (!graphState && service && operation) {
      transformTracesToDDG({traces: props.trace, query: {service, operation, start:0, end:0 }});
      //fetchDeepDependencyGraph({ service, operation, start: 0, end: 0 });
    }
  }

  constructor(props: TProps) {
    super(props);
    DeepDependencyGraphPageImpl.fetchModelIfStale(props);

    const { fetchServices, fetchServiceOperations, operationsForService, services, urlState } = props;
    const { service } = urlState;

    if (!services) {
      fetchServices();
    }
    if (service && !Reflect.has(operationsForService, service)) {
      fetchServiceOperations(service);
    }
  }

  componentWillReceiveProps(nextProps: TProps) {
    /* istanbul ignore next */
    DeepDependencyGraphPageImpl.fetchModelIfStale(nextProps);
  }

  // shouldComponentUpdate is necessary as we don't want the plexus graph to re-render due to a uxStatus change
  shouldComponentUpdate(nextProps: TProps) {
    const updateCauses = [
      'uiFind',
      'operationsForService',
      'services',
      'urlState.service',
      'urlState.operation',
      'urlState.start',
      'urlState.end',
      'urlState.visEncoding',
      'graphState.state',
    ];
    return updateCauses.some(cause => _get(nextProps, cause) !== _get(this.props, cause));
  }

  setDistance = (distance: number, direction: EDirection) => {
    const { graphState } = this.props;
    const { visEncoding } = this.props.urlState;

    if (graphState && graphState.state === fetchedState.DONE) {
      const { model: ddgModel } = graphState;

      this.updateUrlState({
        visEncoding: encodeDistance({
          ddgModel,
          direction,
          distance,
          prevVisEncoding: visEncoding,
        }),
      });
    }
  };

  setOperation = (operation: string) => {
    this.updateUrlState({ operation, visEncoding: undefined });
  };

  setService = (service: string) => {
    const { fetchServiceOperations, operationsForService } = this.props;
    if (!Reflect.has(operationsForService, service)) {
      fetchServiceOperations(service);
    }
    this.updateUrlState({ operation: undefined, service, visEncoding: undefined });
  };

  updateUrlState = (newValues: Partial<TDdgSparseUrlState>) => {
    const { uiFind, urlState, history } = this.props;
    history.push(getUrl({ uiFind, ...urlState, ...newValues }));
  };

  render() {
    const { graph, graphState, operationsForService, services, uiFind, urlState } = this.props;
    const { operation, service, visEncoding } = urlState;
    const distanceToPathElems =
      graphState && graphState.state === fetchedState.DONE ? graphState.model.distanceToPathElems : undefined;
    const uiFindMatches = graph && graph.getVisibleUiFindMatches(uiFind, visEncoding);

    let content = (
      <div>
        <h1>Unknown graphState:</h1>
        <p>${JSON.stringify(graphState)}</p>
      </div>
    );
    if (!graphState) {
      content = <h1>Enter query above</h1>;
    } else if (graphState.state === fetchedState.DONE && graph) {
      const { edges, vertices } = graph.getVisible(visEncoding);
      content = (
        <div className="Ddg--graphWrapper">
          <Graph
            edges={edges}
            getVisiblePathElems={(key: string) => graph.getVisiblePathElems(key, visEncoding)}
            uiFindMatches={uiFindMatches}
            vertices={vertices}
          />
        </div>
      );
    } else if (graphState.state === fetchedState.LOADING) {
      content = <LoadingIndicator centered />;
    } else if (graphState.state === fetchedState.ERROR) {
      content = <ErrorMessage error={graphState.error} />;
    }

    return (
      <div>
        <Header
          distanceToPathElems={distanceToPathElems}
          operation={operation}
          operations={operationsForService[service || '']}
          service={service}
          services={services}
          setDistance={this.setDistance}
          setOperation={this.setOperation}
          setService={this.setService}
          uiFindCount={uiFind ? uiFindMatches && uiFindMatches.size : undefined}
          visEncoding={visEncoding}
        />
        {content}
      </div>
    );
  }
}

// export for tests
export function mapStateToProps(state: ReduxState, ownProps: TOwnProps): TReduxProps {
  const { services: stServices, trace } = state;
  const { services, operationsForService } = stServices;
  const urlState = getUrlState(ownProps.location.search);
  const { density, operation, service, showOp } = urlState;
  let graphState: TDdgStateEntry | undefined;
  // backend temporarily requires service and operation
  // if (service) {
  if (service && operation) {
    graphState = _get(state, ['deepDependencyGraph', stateKey({ service, operation, start: 0, end: 0 })]);
  }
  let graph: TGraph | undefined;
  if (graphState && graphState.state === fetchedState.DONE) {
    graph = makeGraph(graphState.model, showOp, density);
  }
  return {
    trace,
    graph,
    graphState,
    services,
    operationsForService,
    urlState,
    ...extractUiFindFromState(state),
  };
}

// export for tests
export function mapDispatchToProps(dispatch: Dispatch<ReduxState>): TDispatchProps {
  const { fetchDeepDependencyGraph, fetchServiceOperations, fetchServices, transformTracesToDDG } = bindActionCreators(
    jaegerApiActions,
    dispatch
  );

  return { fetchDeepDependencyGraph, fetchServiceOperations, fetchServices, transformTracesToDDG };
}

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(DeepDependencyGraphPageImpl);
