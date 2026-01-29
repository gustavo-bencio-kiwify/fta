// src/slack/constants/actionIds.ts

// ===== HOME (header actions) =====
export const HOME_CREATE_TASK_ACTION_ID = "home_create_task" as const;
export const HOME_SEND_BATCH_ACTION_ID = "home_send_batch" as const;
export const HOME_NEW_PROJECT_ACTION_ID = "home_new_project" as const;

// ===== HOME (tasks list) =====
export const TASK_SELECT_ACTION_ID = "task_select" as const;

export const TASKS_CONCLUDE_SELECTED_ACTION_ID = "tasks_conclude_selected" as const;
export const TASKS_SEND_QUESTION_ACTION_ID = "tasks_send_question" as const;
export const TASKS_RESCHEDULE_ACTION_ID = "tasks_reschedule" as const;
export const TASKS_VIEW_DETAILS_ACTION_ID = "tasks_view_details" as const;
export const TASKS_REFRESH_ACTION_ID = "tasks_refresh" as const;

// ===== NOVOS: você delegou (layout apenas) =====
export const DELEGATED_SELECT_ACTION_ID = "delegated_select" as const;
export const DELEGATED_FUP_ACTION_ID = "delegated_send_fup" as const;
export const DELEGATED_SEND_QUESTION_ACTION_ID = "delegated_send_question" as const;
export const DELEGATED_CONCLUDE_SELECTED_ACTION_ID = "delegated_conclude_selected" as const;
export const DELEGATED_EDIT_ACTION_ID = "delegated_edit" as const;
export const DELEGATED_CANCEL_ACTION_ID = "delegated_cancel" as const;

// ===== NOVOS: você está em cópia (layout apenas) =====
export const CC_SELECT_ACTION_ID = "cc_select" as const;
export const CC_SEND_QUESTION_ACTION_ID = "cc_send_question" as const;

// ===== NOVOS: recorrências (layout apenas) =====
export const RECURRENCE_CANCEL_ACTION_ID = "recurrence_cancel" as const;

// ===== NOVOS: projetos (layout apenas) =====
export const PROJECT_VIEW_ACTION_ID = "project_view" as const;
export const PROJECT_CREATE_TASK_ACTION_ID = "project_create_task" as const;
export const PROJECT_EDIT_ACTION_ID = "project_edit" as const;
export const PROJECT_CONCLUDE_ACTION_ID = "project_conclude" as const;
