import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { DraftailEditor, createEditorStateFromRaw, serialiseEditorStateToRaw } from 'draftail';
import { EditorState, Modifier, RichUtils, SelectionState } from 'draft-js';
import { shallowEqual, Provider, useSelector } from 'react-redux';

import { IS_IE11, STRINGS } from '../../config/wagtailConfig';

import Icon from '../Icon/Icon';

export { default as Link } from './decorators/Link';
export { default as Document } from './decorators/Document';
export { default as ImageBlock } from './blocks/ImageBlock';
export { default as EmbedBlock } from './blocks/EmbedBlock';

import ModalWorkflowSource from './sources/ModalWorkflowSource';
import Tooltip from './Tooltip/Tooltip';
import TooltipEntity from './decorators/TooltipEntity';
import EditorFallback from './EditorFallback/EditorFallback';

// 1024x1024 SVG path rendering of the "↵" character, that renders badly in MS Edge.
const BR_ICON = 'M.436 633.471l296.897-296.898v241.823h616.586V94.117h109.517v593.796H297.333v242.456z';

/**
 * Registry for client-side code of Draftail plugins.
 */
const PLUGINS = {};

const registerPlugin = (plugin) => {
  PLUGINS[plugin.type] = plugin;
  return PLUGINS;
};

/**
 * Wraps a style/block/entity type’s icon with an icon font implementation,
 * so Draftail can use icon fonts in its toolbar.
 */
export const wrapWagtailIcon = type => {
  const isIconFont = type.icon && typeof type.icon === 'string';
  if (isIconFont) {
    return Object.assign(type, {
      icon: <Icon name={type.icon} />,
    });
  }

  return type;
};

function forceResetEditorState(editorState, replacementContent) {
  return EditorState.set(
    EditorState.createWithContent(
      replacementContent ? replacementContent : editorState.getCurrentContent(),
      editorState.getDecorator(),
    ),
    {
      selection: editorState.getSelection(),
      undoStack: editorState.getUndoStack(),
      redoStack: editorState.getRedoStack(),
    },
  );
};

class DraftailInlineAnnotation {
  constructor(initialRef, getEditorState, setEditorState, editor) {
    this.getEditorState = getEditorState;
    this.setEditorState = setEditorState;
    this.editor = editor;
    this.ref = initialRef;
    this.setHidden = null;
    this.setFocused = null;
  }
  onDecoratorAttached(ref) {
    this.ref = ref;
  }
  onClick() {
    if (this.onClickHandler) {
      this.onClickHandler()
    }
  }
  getDesiredPosition() {
    const node = this.ref.current;
    if (node) {
      return node.getBoundingClientRect().top + document.documentElement.scrollTop
    }
    return 0
  }
}

class DraftailCommentWidget {
  constructor(
    fieldNode
  ) {
    this.fieldNode = fieldNode;
    this.contentpath = window.comments.getContentPath(fieldNode); 
    this.commentsEnabled = false;
    this.annotations = new Map();
    this.makeComment = null;
    this.setEditorState = null;
    this.getEditorState = null;
  }
  onRegister(makeComment) {
    this.makeComment = makeComment;
  }
  setEnabled(enabled) {
    // Update whether comments are enabled for the page
    this.commentsEnabled = enabled;
  }
  onChangeComments(comments) {
    // Receives a list of comments for the widget's contentpath
    this.commentNumber = comments.length;
  }
  //getAnnotationForComment(comment) {
  //  return new BasicFieldLevelAnnotation(this.fieldNode, annotationNode);
  //}
  getPlugin() {
    const plugin = {
      initialize: (PluginFunctions) => {
        this.setEditorState = PluginFunctions.setEditorState;
        this.getEditorState = PluginFunctions.getEditorState;
      }
    }
    return plugin;
  }
  getControl() {

  }
  getSource() {
    const CommentSource = ({ editorState, onComplete }) => {
      useEffect(() => {
        const annotation = new DraftailInlineAnnotation({current: this.fieldNode.parentNode}, this.getEditorState, this.setEditorState, this.fieldNode.draftailEditor);
        const commentId = window.commentApp.makeComment(annotation, this.contentpath);
        this.annotations.set(commentId, annotation);
        const nextState = RichUtils.toggleInlineStyle(editorState, `COMMENT-${commentId}`);
        onComplete(nextState);
        }, []
    );
      return null
    };
    return CommentSource;
  }
  getDecorator() {
    const CommentDecorator = ({ contentState, children }) => {
      const blockKey = children[0].props.block.getKey()
      const start = children[0].props.start
      const commentId = useMemo(() => parseInt(contentState.getBlockForKey(blockKey).getInlineStyleAt(start).find((style) => style.startsWith('COMMENT')).slice(8)), [blockKey, start]);
      const focusedComment = useSelector(window.commentApp.selectors.selectFocused);
      const annotationNode = useRef(null);
      useEffect(() => {
        const comment = window.commentApp.store.getState().comments.comments.get(commentId)
        if (comment) {
          comment.annotation.onDecoratorAttached(annotationNode);
        }
      });
      const onClick = () => {
        window.commentApp.store.dispatch(
          window.commentApp.actions.setFocusedComment(commentId)
        );
        window.commentApp.store.dispatch(
          window.commentApp.actions.setPinnedComment(commentId)
        );
      }
    
      return (
        <button type="button" className="button unbutton" style={{'text-transform': 'none', 'background-color': (focusedComment !== commentId) ? '#01afb0' : '#007d7e'}} ref={annotationNode} onClick={onClick} data-annotation>
          {children}
        </button>
      )
    }
    return CommentDecorator
  }
  getDecoratorStrategy() {
    return (contentBlock, callback, contentState) => {
      contentBlock.findStyleRanges((metadata) => metadata.getStyle().some((style) => style.startsWith('COMMENT')), (start, end) => {callback(start, end)})
    }
  }
}


function CommentableEditor({plugins, field, editorRef, rawContentState, onSave, options, enableHorizontalRule}) {
  const commentWidget = useMemo(() => new DraftailCommentWidget(field), [field])
  const commentsSelector = useMemo(() => window.commentApp.utils.selectCommentsForContentPathFactory(commentWidget.contentpath), [commentWidget]);
  const comments = useSelector(commentsSelector, shallowEqual)
  const enabled = useSelector(window.commentApp.selectors.selectEnabled);
  const commentEntity = {
    type: "COMMENT",
    icon: <Icon name="comment"/>,
    source: commentWidget.getSource(),
  }
  const blockTypes = options.blockTypes || [];
  const inlineStyles = options.inlineStyles || [];
  let entityTypes = options.entityTypes || [];

  entityTypes = entityTypes.map(wrapWagtailIcon).map((type) => {
    const plugin = PLUGINS[type.type];

    // Override the properties defined in the JS plugin: Python should be the source of truth.
    return Object.assign({}, plugin, type);
  });
  const decorators = [{
    strategy: commentWidget.getDecoratorStrategy(),
    component: commentWidget.getDecorator(),
  }];

  const [editorState, setEditorState] = useState(() => createEditorStateFromRaw(rawContentState));

  useEffect(() => {
    const allowedCommentIds = new Set(comments.map((comment) => comment.localId));
    const commentIds = new Set();
    let contentState = editorState.getCurrentContent()
    const blocks = contentState.getBlocksAsArray();
    blocks.forEach((block) => {
      block.findStyleRanges(
        (metadata) => metadata.getStyle().some((style) => style.startsWith('COMMENT')), 
        (start) => {block.getInlineStyleAt(start).filter((style) => style.startsWith('COMMENT')).forEach((value => commentIds.add(parseInt(value.slice(8)))))})
    })
    console.log(commentIds);
    const lastBlock = contentState.getLastBlock();
    let fullSelectionState = SelectionState.createEmpty();
    fullSelectionState = fullSelectionState.set('anchorKey', contentState.getFirstBlock().getKey());
    fullSelectionState = fullSelectionState.set('focusKey', lastBlock.getKey());
    fullSelectionState = fullSelectionState.set('anchorOffset', 0);
    fullSelectionState = fullSelectionState.set('focusOffset', lastBlock.getLength());
    commentIds.forEach((id) => {
      if (!allowedCommentIds.has(id)) {
        contentState = Modifier.removeInlineStyle(contentState, fullSelectionState, 'COMMENT-'+id);
      }
    })
    if (contentState !== editorState.getCurrentContent()) {
      setEditorState(forceResetEditorState(editorState, contentState));
    }
  }, [comments])



  const timeoutRef = useRef();
  useEffect(() => {
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(
      onSave(serialiseEditorStateToRaw(editorState)),
      250,
    );
    return () => {
      onSave(serialiseEditorStateToRaw(editorState));
      window.clearTimeout(timeoutRef.current);
    }
  }, [editorState]);
  return   <EditorFallback field={field}>
  <DraftailEditor
    ref={editorRef}
    editorState={forceResetEditorState(editorState)}
    onChange={setEditorState}
    placeholder={STRINGS.WRITE_HERE}
    spellCheck={true}
    onChange={setEditorState}
    enableLineBreak={{
      description: STRINGS.LINE_BREAK,
      icon: BR_ICON,
    }}
    showUndoControl={{ description: STRINGS.UNDO }}
    showRedoControl={{ description: STRINGS.REDO }}
    maxListNesting={4}
    // Draft.js + IE 11 presents some issues with pasting rich text. Disable rich paste there.
    stripPastedStyles={IS_IE11}
    {...options}
    plugins={[{
      
    }]}
    decorators={decorators}
    blockTypes={blockTypes.map(wrapWagtailIcon)}
    inlineStyles={inlineStyles.map(wrapWagtailIcon)}
    entityTypes={enabled ? entityTypes.concat(commentEntity) : entityTypes}
    enableHorizontalRule={enableHorizontalRule}
  />
</EditorFallback>
}

function CommentStoreWrapper({plugins, field, editorRef, rawContentState, onSave, options, enableHorizontalRule}) {
  return <Provider store={window.commentApp.store}>
    <CommentableEditor
      field={field}
      plugins={plugins}
      editorRef={editorRef}
      rawContentState={rawContentState}
      onSave={onSave}
      options={options}
      enableHorizontalRule={enableHorizontalRule}
    />
  </Provider>
}

/**
 * Initialises the DraftailEditor for a given field.
 * @param {string} selector
 * @param {Object} options
 * @param {Element} currentScript
 */
const initEditor = (selector, options, currentScript) => {
  // document.currentScript is not available in IE11. Use a fallback instead.
  const context = currentScript ? currentScript.parentNode : document.body;
  // If the field is not in the current context, look for it in the whole body.
  // Fallback for sequence.js jQuery eval-ed scripts running in document.head.
  const field = context.querySelector(selector) || document.body.querySelector(selector);

  const editorWrapper = document.createElement('div');
  editorWrapper.className = 'Draftail-Editor__wrapper';
  editorWrapper.setAttribute('data-draftail-editor-wrapper', true);

  field.parentNode.appendChild(editorWrapper);

  const serialiseInputValue = rawContentState => {
    field.rawContentState = rawContentState;
    field.value = JSON.stringify(rawContentState);
  };

  const enableHorizontalRule = options.enableHorizontalRule ? {
    description: STRINGS.HORIZONTAL_LINE,
  } : false;

  const rawContentState = JSON.parse(field.value);
  field.rawContentState = rawContentState;

  const editorRef = (ref) => {
    // Bind editor instance to its field so it can be accessed imperatively elsewhere.
    field.draftailEditor = ref;
    console.log(field);
  };

  const editor = (
      <CommentStoreWrapper
        field={field}
        editorRef={editorRef}
        rawContentState={rawContentState}
        onSave={serialiseInputValue}
        options={options}
        plugins={[]}
        enableHorizontalRule={enableHorizontalRule}
      />
  );

  ReactDOM.render(editor, editorWrapper);
};

export default {
  initEditor,
  registerPlugin,
  // Components exposed for third-party reuse.
  ModalWorkflowSource,
  Tooltip,
  TooltipEntity,
};
