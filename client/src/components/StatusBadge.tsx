import React from 'react';

interface Props {
  status: number;
}

const StatusBadge: React.FC<Props> = ({ status }) => {
  let colorClass = 'status-badge-gray';
  
  if (status >= 200 && status < 300) {
    colorClass = 'status-badge-green';
  } else if (status >= 400 && status < 500) {
    colorClass = 'status-badge-yellow';
  } else if (status >= 500) {
    colorClass = 'status-badge-red';
  }

  return (
    <span className={`status-badge ${colorClass}`}>
      {status === 0 ? 'ERR' : status}
    </span>
  );
};

export default StatusBadge;
