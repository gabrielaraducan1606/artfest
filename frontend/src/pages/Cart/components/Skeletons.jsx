import React from 'react';


export const SkeletonHeader = ()=> (
<div className="flex items-center justify-between">
<div className="h-8 w-64 bg-gray-200 rounded"/>
<div className="h-5 w-56 bg-gray-200 rounded"/>
</div>
);


export const SkeletonRow = ()=> (
<div className="flex gap-3 items-center py-3">
<div className="w-16 h-16 bg-gray-200 rounded-xl"/>
<div className="flex-1 space-y-2">
<div className="h-4 w-1/2 bg-gray-200 rounded"/>
<div className="h-4 w-1/3 bg-gray-200 rounded"/>
</div>
<div className="w-24 h-10 bg-gray-200 rounded"/>
<div className="w-20 h-6 bg-gray-200 rounded"/>
</div>
);