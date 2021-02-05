import { initCommentApp } from 'wagtail-comment-frontend';
import { STRINGS } from '../../config/wagtailConfig';

function initComments() {
  window.commentApp = initCommentApp();
  document.addEventListener('DOMContentLoaded', () => {
    const commentsElement = document.getElementById('comments');
    const commentsOutputElement = document.getElementById('comments-output');
    const dataElement = document.getElementById('comments-data');
    if (!commentsElement || !commentsOutputElement || !dataElement) {
      throw new Error('Comments app failed to initialise. Missing HTML element');
    }
    const data = JSON.parse(dataElement.textContent);
    window.commentApp.renderApp(
      commentsElement, commentsOutputElement, data.user, data.comments, new Map(Object.entries(data.authors)), STRINGS
    );
  });
}

function getContentPath(fieldNode) {
  // Return the total contentpath for an element as a string, in the form field.streamfield_uid.block...
  if (fieldNode.closest('data-contentpath-disabled')) {
    return '';
  }
  let element = fieldNode.closest('[data-contentpath]');
  const contentpaths = [];
  while (element !== null) {
    contentpaths.push(element.dataset.contentpath);
    element = element.parentElement.closest('[data-contentpath]');
  }
  contentpaths.reverse();
  return contentpaths.join('.');
}

class BasicFieldLevelAnnotation {
  constructor(fieldNode, node) {
    this.node = node;
    this.fieldNode = fieldNode;
    this.position = '';
    this.unsubscribe = null;
  }
  subscribeToUpdates(localId, store) {
    const initialState = store.getState()
    let focused = false;
    let shown = initialState.settings.commentsEnabled;
    if (initialState.comments.focusedComment === localId) {
      this.onFocus()
      focused = true;
    }
    this.unsubscribe = store.subscribe(() => 
      {
        const state = store.getState()
        const comment = state.comments.comments.get(localId);
        if (comment === undefined) {
          this.onDelete();
        }
        const nowFocused = (state.comments.focusedComment === localId)
        if (nowFocused !== focused) {
          if (focused) {
            this.onUnfocus();
          } else {
            this.onFocus();
          }
        }
        focused = nowFocused;
        if (shown !== state.settings.commentsEnabled) {
          if (shown) {
            this.hide();
          } else {
            this.show();
          }
        }
        shown = state.settings.commentsEnabled;
      }
    )
  }
  onDelete() {
    this.node.remove();
    if (this.unsubscribe) {
      this.unsubscribe()
    }
  }
  onFocus() {
    this.node.classList.remove('button-secondary');
    this.node.ariaLabel = STRINGS.UNFOCUS_COMMENT;
  }
  onUnfocus() {
    this.node.classList.add('button-secondary');
    this.node.ariaLabel = STRINGS.UNFOCUS_COMMENT;
    // TODO: ensure comment is focused accessibly when this is clicked,
    // and that screenreader users can return to the annotation point when desired
  }
  show() {
    this.node.classList.remove('u-hidden');
  }
  hide() {
    this.node.classList.add('u-hidden');
  }
  setOnClickHandler(handler) {
    this.node.addEventListener('click', handler);
  }
  getDesiredPosition() {
    return (
      this.fieldNode.getBoundingClientRect().top +
      document.documentElement.scrollTop
    );
  }
}

class FieldLevelCommentWidget {
  constructor({
    fieldNode,
    commentAdditionNode,
    annotationTemplateNode,
  }) {
    this.fieldNode = fieldNode;
    this.contentpath = getContentPath(fieldNode);
    this.commentAdditionNode = commentAdditionNode;
    this.annotationTemplateNode = annotationTemplateNode;
    this.commentNumber = 0;
    this.commentsEnabled = false;
  }
  register(commentApp) {
    const state = commentApp.store.getState();
    let currentlyEnabled = state.settings.commentsEnabled;
    this.setEnabled(currentlyEnabled);
    const unsubscribeWidgetEnable = commentApp.store.subscribe(() => {
      const previouslyEnabled = currentlyEnabled;
      currentlyEnabled = commentApp.store.getState().settings.commentsEnabled;
      if (previouslyEnabled !== currentlyEnabled) {
        this.setEnabled(currentlyEnabled);
      }
    });
    const selectCommentsForContentPath = commentApp.selectCommentsForContentPathFactory(
      this.contentpath
    );
    let currentComments = selectCommentsForContentPath(state);
    const unsubscribeWidgetComments = commentApp.store.subscribe(() => {
      const previousComments = currentComments;
      currentComments = selectCommentsForContentPath(commentApp.store.getState());
      if (previousComments !== currentComments) {
        this.commentNumber = currentComments.length;
        this.updateVisibility()
        currentComments.filter((comment) => comment.annotation === null).forEach((comment) => {
          const annotation = this.getAnnotationForComment(comment);
          commentApp.updateAnnotation(
            annotation,
            comment.localId
          );
          annotation.subscribeToUpdates(comment.localId, commentApp.store);
        });
      }
    });
    state.comments.comments.forEach((comment) => {
      if (comment.contentpath === widget.contentpath) {
        const annotation = this.getAnnotationForComment(comment);
        commentApp.updateAnnotation(annotation, comment.localId);
        annotation.subscribeToUpdates(localId, commentApp.store);
      }
    });
    this.commentAdditionNode.addEventListener('click', () => {
      const annotation = this.getAnnotationForComment();
      const localId = commentApp.makeComment(annotation, this.contentpath);
      annotation.subscribeToUpdates(localId, commentApp.store);
    });
    return { unsubscribeWidgetEnable, unsubscribeWidgetComments }; // TODO: listen for widget deletion and use these
  }
  setEnabled(enabled) {
    // Update whether comments are enabled for the page
    this.commentsEnabled = enabled;
    this.updateVisibility();
  }
  onChangeComments(comments) {
    // Receives a list of comments for the widget's contentpath
    this.commentNumber = comments.length;
    this.updateVisibility();
  }
  updateVisibility() {
    // if comments are disabled, or the widget already has at least one associated comment,
    // don't show the comment addition button
    if (!this.commentsEnabled || this.commentNumber > 0) {
      this.commentAdditionNode.classList.add('u-hidden');
    } else {
      this.commentAdditionNode.classList.remove('u-hidden');
    }
  }
  getAnnotationForComment() {
    const annotationNode = this.annotationTemplateNode.cloneNode(true);
    annotationNode.id = '';
    annotationNode.classList.remove('u-hidden');
    this.commentAdditionNode.insertAdjacentElement('afterend', annotationNode);
    return new BasicFieldLevelAnnotation(this.fieldNode, annotationNode);
  }
}

function initFieldLevelCommentWidget(fieldElement) {
  const widget = new FieldLevelCommentWidget({
    fieldNode: fieldElement,
    commentAdditionNode: fieldElement.querySelector('[data-comment-add]'),
    annotationTemplateNode: document.querySelector('#comment-icon')
  });
  if (widget.contentpath) {
    widget.register(window.commentApp);
  }
}

export default {
  getContentPath,
  initComments,
  FieldLevelCommentWidget,
  initFieldLevelCommentWidget
};
