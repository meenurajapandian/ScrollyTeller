/* global document, window */
import {
  get,
  forEach,
  isNil,
  isNumber,
  isString,
  isUndefined,
  noop,
  reduce,
} from 'lodash-es';
import elementResizeDetectorMaker from 'element-resize-detector';
import { select } from 'd3-selection';
import * as utils from './utils';
import scrollIntoView from 'scroll-into-view';
import 'intersection-observer';
import scrollama from 'scrollama';
import CSSNames from './utils/CSSNames';

// How far from the top of the viewport to trigger a step.
const TRIGGER_OFFSET = 0.5;

export default class ScrollyTeller {
  /**
   * Validates scrollyTellerConfig, converts any narration or data promises in the sectionList to arrays of data
   * or narration, and builds the HTML necessary for a scrolling story
   * @param {object} config object containing configuration
   */
  constructor(config) {
    utils.validateScrollyTellerConfig(config);

    this.appContainerId = config.appContainerId;
    this.sectionList = config.sectionList;

    /** state to handle advancing to previous/next narration */
    this.sectionNamesArray = Object.keys(this.sectionList);
    this.currentSectionId = '';
    this.currentNarrationIndex = null;

    /** if cssNames is unassigned,
     * use the default CSSNames constructor to create a new one */
    if (isUndefined(config.cssNames) || (config.cssNames.constructor.name !== 'CSSNames')) {
      this.cssNames = new CSSNames();
    } else {
      this.cssNames = config.cssNames;
    }

    this._assignConfigVariablesToSectionConfigs(this.cssNames);

    this._triggersDisabled = false;
  }

  /** 'PRIVATE' METHODS * */

  _assignConfigVariablesToSectionConfigs() {
    forEach(this.sectionList, (section) => {
      section.appContainerId = this.appContainerId;
      section.cssNames = this.cssNames;
    });
  }

  _graphIdForSection(config) {
    return config.cssNames.graphId(config.sectionIdentifier);
  }

  _buildGraphs() {
    forEach(this.sectionList, (config) => {
      const { state } = this._triggerState({ sectionConfig: config, index: 0, progress: 0 });

      const containerId = config.cssNames.graphContainerId(config.sectionIdentifier)
      this._updateTitleAndCaption({
        graphContainer: select(`#${containerId}`),
        index: 0,
        names: config.cssNames,
        narration: config.narration,
        state,
      });

      config.graph = config.buildGraphFunction(this._graphIdForSection(config), config);
    });
  }

  _triggerState({ sectionConfig, index, progress }) {
    const {
      narration,
      convertTriggerToObject = false,
    } = sectionConfig;

    const trigger = (convertTriggerToObject)
      ? utils.getStateFromTrigger(sectionConfig, narration[index].trigger, { index, progress })
      : narration[index].trigger || '';

    const state = (convertTriggerToObject)
      ? utils.getNarrationState(sectionConfig, index, progress)
      : {};

    return { trigger, state };
  }

  _updateTitleAndCaption({
    graphContainer, index, names, narration, state
  }) {
    utils.updateTitle({
      graphContainer,
      index,
      names,
      narration,
      state,
    });

    utils.updateCaption({
      graphContainer,
      index,
      names,
      narration,
      state,
    });
  }

  _handleOnStepEnter(sectionConfig, { element, index, direction }) {
    if (this._triggersDisabled) {
      return;
    }
    const {
      narration,
      cssNames: names,
      sectionIdentifier,
      onActivateNarrationFunction = noop,
    } = sectionConfig;

    this.currentSectionId = sectionIdentifier;
    this.currentNarrationIndex = index;

    const graphId = names.graphId(sectionIdentifier);
    const graphContainerId = names.graphContainerId(sectionIdentifier);

    const progress = 0;

    const { trigger, state } = this._triggerState({ sectionConfig, index, progress });

    select(element).classed('active', true);
    const graphContainer = select(`#${graphContainerId}`).classed('active', true);
    const graph = select(`#${graphId}`);

    this._updateTitleAndCaption({
      graphContainer,
      index,
      names,
      narration,
      state,
    });

    utils.updateGraphStyles({
      graph,
      graphContainer,
      names,
      sectionIdentifier,
      state,
    });

    onActivateNarrationFunction({
      index,
      progress,
      element,
      trigger,
      state,
      direction,
      graphId,
      graphContainerId,
      sectionConfig,
    });
  }

  _handleOnStepExit(sectionConfig, { index, element, direction }) {
    if (this._triggersDisabled) {
      return;
    }
    const {
      narration,
      cssNames: names,
      sectionIdentifier,
    } = sectionConfig;

    select(element).classed('active', false);

    if ((index === narration.length - 1 && direction === 'down')
      || (index === 0 && direction === 'up')
    ) {
      const graphContainerId = `#${names.graphContainerId(sectionIdentifier)}`;
      select(graphContainerId).classed('active', false);
    }
  }

  _handleOnStepProgress(sectionConfig, { element, scrollProgressElement, index }) {
    if (this._triggersDisabled) {
      return;
    }
    const {
      cssNames: names,
      sectionIdentifier,
      onScrollFunction = noop,
    } = sectionConfig;

    const graphId = names.graphId(sectionIdentifier);
    const graphContainerId = names.graphContainerId(sectionIdentifier);

    /** recalculate scroll progress due to intersection observer bug in Chrome
     *  https://github.com/russellgoldenberg/scrollama/issues/64
     *  TODO: revert back to using scrollama progress if/when issue is resolved */
    const progress = utils.calcScrollProgress(scrollProgressElement || element, TRIGGER_OFFSET);

    const { trigger, state } = this._triggerState({ sectionConfig, index, progress });

    utils.updateGraphStyles({
      graph: select(`#${graphId}`),
      graphContainer: select(`#${graphContainerId}`),
      names,
      sectionIdentifier,
      state,
    });

    onScrollFunction({
      index,
      progress,
      element,
      trigger,
      state,
      graphId,
      graphContainerId,
      sectionConfig,
    });
  }

  _buildScrollamaContainers() {
    forEach(this.sectionList, (sectionConfig) => {
      const css = get(sectionConfig, ['cssNames', 'css']);

      const {
        cssNames: names,
        sectionIdentifier,
      } = sectionConfig;

      sectionConfig.scroller = scrollama();

      const sectionId = names.sectionId(sectionIdentifier);
      const graphContainerId = names.graphContainerId(sectionIdentifier);

      sectionConfig.scroller
        .setup({
          step: `#${sectionId} .${css.narrationBlock}`,
          container: `#${sectionId}`,
          graphic: `#${graphContainerId}`,
          offset: TRIGGER_OFFSET,
          progress: true,
        })
        .onStepEnter((payload) => { this._handleOnStepEnter(sectionConfig, payload); })
        .onStepExit((payload) => { this._handleOnStepExit(sectionConfig, payload); })
        .onStepProgress((payload) => { this._handleOnStepProgress(sectionConfig, payload); });
    });
  }

  _buildKeyboardListeners() {
    // prevent default scroll using spacebar and arrow keys
    document.addEventListener('keydown', (event) => {
      const key = event.key || event.keyCode;

      if (event.target === document.body) {
        switch (key) {
          case ' ':
          case 'ArrowDown':
          case 'ArrowRight':
          case 'ArrowUp':
          case 'ArrowLeft':
            event.preventDefault();
            break;
          default:
        }
      }
    });

    document.addEventListener('keyup', (event) => {
      if (event.defaultPrevented) {
        return;
      }

      if (event.target === document.body) {
        const key = event.key || event.keyCode;

        switch (key) {
          case ' ':
          case 'ArrowDown':
          case 'ArrowRight':
            this.scrollToNextNarration();
            break;
          case 'ArrowUp':
          case 'ArrowLeft':
            this.scrollToPreviousNarration();
            break;
          default:
        }
      }
    });
  }

  _buildResizeListeners() {
    forEach(this.sectionList, (sectionConfig) => {
      const {
        cssNames: names,
        onResizeFunction = noop,
        sectionIdentifier,
      } = sectionConfig;

      const graphId = names.graphId(sectionIdentifier);
      const graphContainerId = names.graphContainerId(sectionIdentifier);

      sectionConfig.elementResizeDetector = elementResizeDetectorMaker({
        strategy: 'scroll',
      });

      sectionConfig.elementResizeDetector
        .listenTo(
          select(`#${graphId}`).node(),
          (element) => {
            onResizeFunction({
              graphElement: element,
              graphContainerId,
              graphId,
              sectionConfig,
            });
          },
        );
    });
  }

  _buildSections() {
    select(`#${this.appContainerId}`)
      .append('div')
      .attr('class', this.cssNames.scrollContainer());

    forEach(this.sectionList, utils.buildSectionWithNarration);
  }

  _getScrollAlignObject(sectionId, narrationIndex) {
    const { cssNames, sectionList } = this;
    // create a selector for the target narration block and select that element
    const targetNarrationSelector = [
      `#${cssNames.sectionId(sectionId)}`,
      `.${cssNames.narrationList()}`,
      `:nth-child(${narrationIndex + 1})`,
      `.${cssNames.narrationConcentClass()}`,
    ].join(' ');

    const { height } = select(targetNarrationSelector).node().getBoundingClientRect();

    const spaceAbove = utils.vhToNumericPx(
      sectionList[sectionId].narration[narrationIndex].spaceAboveInVh,
    );

    return {
      align: {
        topOffset: spaceAbove - (height / 2),
      },
    };
  }


  /** 'PUBLIC' METHODS * */

  /**
   * Converts all narration promises to data, and all data promises to processed data,
   * then build all the necessary HTML
   * @returns {Promise<void>} that is resolved when everything is built
   */
  async render() {
    await utils.fetchNarration(this.sectionList);
    await utils.fetchDataAndProcessResults(this.sectionList);
    /** then build the html we need along with the graph scroll objects for each section */
    this._buildSections();
    this._buildScrollamaContainers();
    this._buildGraphs();
    this._buildResizeListeners();
    this._buildKeyboardListeners();

    window.addEventListener('resize', () => {
      forEach(this.sectionList, (config) => {
        utils.resizeNarrationBlocks(config);
        config.scroller.resize();
      });
    });
  }

  /**
   * @param {string|number} sectionIdentifier - `sectionIdentifier` of the target section
   * @param {string|number|undefined} [narrationIdStringOrNumericIndex]
   *  - optional: if undefined, defaults to the first narration block of target section
   *              if number, argument is treated as the index of the narration block to scroll to
   *              if string, argument is treated as the `narrationId` of the target narration block
   * @param {object} [options] - optional: configuration object passed to `scrollIntoView`
   *              (https://github.com/KoryNunn/scroll-into-view)
   * @returns {Promise<void>} - returns empty promise
   */
  async scrollTo(sectionIdentifier, narrationIdStringOrNumericIndex, options) {
    const { appContainerId, cssNames, sectionList } = this;

    // Find the sectionConfig.
    const sectionConfig = sectionList[sectionIdentifier];

    // Find the index of the target narration block to scroll to.
    let index = 0; // undefined case, treat as zero index
    // string case: treat as narration id
    if (isString(narrationIdStringOrNumericIndex)) {
      index = sectionConfig.narration.findIndex(
        // eslint-disable-next-line eqeqeq
        (block) => { return block.narrationId === narrationIdStringOrNumericIndex; },
      ) || 0;
    } else if ( // numeric case: treat as index
      isNumber(narrationIdStringOrNumericIndex)
      && narrationIdStringOrNumericIndex > -1
      && narrationIdStringOrNumericIndex < sectionConfig.narration.length
    ) {
      index = narrationIdStringOrNumericIndex;
    }

    // create a selector for the target narration block and select that element
    const targetNarrationSelector = [
      `#${cssNames.sectionId(sectionIdentifier)}`,
      `.${cssNames.narrationList()}`,
      `div.${cssNames.narrationClass()}:nth-of-type(${index + 1})`,
    ].join(' ');
    const narrationBlockSelection = select(targetNarrationSelector); // d3 selection
    const narrationBlockElement = narrationBlockSelection.node(); // node

    // select the content element within the desired narration block, which we'll scroll directly to
    const scrollToContentElement = narrationBlockSelection.select(
      `div.${cssNames.narrationContentClass()}`,
    ).node();

    // Get the page position, so we can determine which direction we've scrolled.
    const startingYOffset = window.pageYOffset;

    // Remove CSS class 'active' on all elements within the ScrollyTeller container element.
    select(`#${appContainerId}`).selectAll('.active').classed('active', false);
    // Set a flag to prevent trigger callbacks from executing during scrolling.
    this._triggersDisabled = true;
    // Scroll the page (asynchronously).
    await new Promise((resolve) => {
      scrollIntoView(scrollToContentElement, options, resolve);
    });
    // Re-enable trigger callbacks.
    this._triggersDisabled = false;

    // Compute the direction of scrolling.
    const direction = window.pageYOffset < startingYOffset ? 'up' : 'down';
    // Manually activate triggers for the current narration (since they won't have fired on scroll).
    this._handleOnStepEnter(sectionConfig, { element: narrationBlockElement, index, direction });
    this._handleOnStepProgress(
      sectionConfig,
      {
        element: narrationBlockElement,
        index,
        scrollProgressElement: scrollToContentElement,
      });
  }

  /**
   * Scrolls "up" to the previous narration block in the story
   * @return {Promise<void>} - returns empty promise
   */
  async scrollToPreviousNarration() {
    const {
      currentNarrationIndex,
      currentSectionId,
      sectionList,
      sectionNamesArray,
    } = this;
    const sectionIndex = sectionNamesArray.findIndex(
      (id) => { return id === currentSectionId; },
    );

    this.currentSectionId = sectionIndex === -1 ? sectionNamesArray[0] : currentSectionId;
    this.currentNarrationIndex = currentNarrationIndex === null
      ? 1
      : currentNarrationIndex;

    const isFirstSection = sectionIndex === 0;
    const isNarrationInPreviousSection = this.currentNarrationIndex - 1 < 0;

    if (isNarrationInPreviousSection && !isFirstSection) {
      this.currentSectionId = sectionNamesArray[sectionIndex - 1];
      const currentNarration = get(sectionList, [this.currentSectionId, 'narration']);
      this.currentNarrationIndex = currentNarration ? currentNarration.length - 1 : 0;
    } else if (!isNarrationInPreviousSection) {
      this.currentNarrationIndex = this.currentNarrationIndex - 1;
    } else {
      return;
    }

    await this.scrollTo(
      this.currentSectionId,
      this.currentNarrationIndex,
      this._getScrollAlignObject(this.currentSectionId, this.currentNarrationIndex),
    );
  }

  /**
   * Scrolls "down" to the next narration block in the story
   * @return {Promise<void>} - returns empty promise
   */
  async scrollToNextNarration() {
    const {
      currentNarrationIndex,
      currentSectionId,
      sectionList,
      sectionNamesArray,
    } = this;
    const sectionIndex = sectionNamesArray.findIndex(
      (id) => { return id === currentSectionId; },
    );

    this.currentSectionId = sectionIndex === -1 ? sectionNamesArray[0] : currentSectionId;
    this.currentNarrationIndex = currentNarrationIndex === null ? -1 : currentNarrationIndex;

    const isLastSection = sectionIndex === sectionNamesArray.length - 1;
    const currentSectionNarrationCount = get(
      sectionList,
      [this.currentSectionId, 'narration', 'length'],
      0,
    );
    const isNarrationInNextSection = this.currentNarrationIndex + 1
      === currentSectionNarrationCount;

    if (isNarrationInNextSection && !isLastSection) {
      this.currentSectionId = sectionNamesArray[sectionIndex + 1];
      this.currentNarrationIndex = 0;
    } else if (!isNarrationInNextSection) {
      this.currentNarrationIndex = this.currentNarrationIndex + 1;
    } else {
      return;
    }

    await this.scrollTo(
      this.currentSectionId,
      this.currentNarrationIndex,
      this._getScrollAlignObject(this.currentSectionId, this.currentNarrationIndex),
    );
  }
}
