import { Outlet, useParams } from '@tanstack/react-router';
import { Board } from './board';

/** The Tasks tab: the board, with the task panel route rendering over it through the outlet. */
export function TasksTab() {
  const { groupId } = useParams({ strict: false });
  return (
    <>
      {groupId && <Board groupId={groupId} />}
      <Outlet />
    </>
  );
}
